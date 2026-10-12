import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { fixtureBundle, generateBundle } from "@voidaccess/ingest/test-support";
import { archiveContext, archiveGraph, archiveRun, type Probe } from "../src";
import { MemoryObjectStore, memoryDeps } from "../src/test-support";
import { appDb, ownerPool, resetArchive } from "./helpers";

const db = appDb();
afterAll(async () => {
  await db.close();
  await ownerPool().end();
});

const ms = (f: () => Promise<unknown>) => async () => {
  const t = performance.now();
  await f();
  return performance.now() - t;
};

describe("archive context latency (375-entity investigation, warm database)", () => {
  const big = fixtureBundle("blackcat-standard-onion", false);
  const probe: Probe = {
    entities: big.entities.map((e) => ({
      key: e.id,
      type: e.type,
      value: e.sensitive ? null : e.value,
      fingerprint: null,
    })),
    ownSources: big.sources.map((s) => ({ url: s.url, kind: s.kind, name: s.name })),
  };

  beforeAll(async () => {
    await resetArchive();
    const store = new MemoryObjectStore();
    // a realistic archive: the three public fixtures plus ~25,000 synthetic entities and ~75,000 relationships
    for (const [i, name] of (["lockbit-deep", "dprk-deep-typed"] as const).entries()) {
      await archiveRun(
        `00000000-0000-4000-8000-0000000003${i}0`,
        memoryDeps(fixtureBundle(name, false), null, store),
        { database: db },
      );
    }
    for (let i = 0; i < 5; i++)
      await archiveRun(
        `00000000-0000-4000-8000-0000000004${i}0`,
        memoryDeps(generateBundle({ seed: 700 + i }), null, store),
        { database: db },
      );
    // the viewer's own run is archived too, as the worker would have done by now
    await archiveRun("00000000-0000-4000-8000-000000000500", memoryDeps(big, null, store), { database: db });
    await ownerPool().query("analyze");
  }, 180_000);

  it("answers in well under 300 ms and reports its plans", async () => {
    const counts = (
      await ownerPool().query(
        "select (select count(*) from archive_entities)::int e, (select count(*) from archive_observations)::int o, (select count(*) from archive_relationships)::int r, (select count(*) from archive_relationship_sources)::int rs",
      )
    ).rows[0];
    await archiveContext(probe, { database: db }); // warm
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) runs.push(await ms(() => archiveContext(probe, { database: db }))());
    runs.sort((a, b) => a - b);
    const graph = await ms(() => archiveGraph(probe, { database: db, hops: 2 }))();
    const lite = await ms(() => archiveContext(probe, { database: db, lite: true }))();
    const ctx = await archiveContext(probe, { database: db });
    console.log(
      `ARCHIVE SIZE ${JSON.stringify(counts)}; context(375 entities) median ${runs[3]!.toFixed(0)} ms, p100 ${runs[6]!.toFixed(0)} ms; lite ${lite.toFixed(0)} ms; 2-hop graph ${graph.toFixed(0)} ms; seen ${ctx.totals.seenBefore}/${ctx.totals.entities}, neighbours ${ctx.neighbours.length}`,
    );
    expect(runs[3]!).toBeLessThan(300);
    expect(graph).toBeLessThan(600);
  });

  it("prints the query plans (indexes are used)", async () => {
    const pubKeys = probe.entities.slice(0, 375).filter((e) => e.value);
    const types = pubKeys.map((e) => e.type);
    const vals = pubKeys.map((e) => e.value!.toLowerCase());
    const plan = async (q: ReturnType<typeof sql>) =>
      (
        (await db.db.execute(sql`explain (analyze, costs off, timing off) ${q}`)).rows as {
          "QUERY PLAN": string;
        }[]
      )
        .map((r) => r["QUERY PLAN"])
        .join("\n");
    const arr = (xs: string[], t: string) =>
      sql`ARRAY[${sql.join(
        xs.map((x) => sql`${x}`),
        sql`, `,
      )}]::${sql.raw(t)}[]`;
    const q1 = sql`select e.id from unnest(${arr(vals, "text")}, ${arr(types, "text")}) as q(v, t) join archive_entities e on e.type = q.t and e.canonical_value = q.v and e.tombstoned_at is null`;
    const p1 = await plan(q1);
    console.log(`PLAN entity match, 375 probes, ~25k-entity archive (default planner):\n${p1}`);
    // at this size a hash join over the table is cheapest; the unique index is what keeps it cheap at millions of rows
    const forced = await db.withSystem(
      "t.plan",
      async (tx) => {
        await tx.execute(sql`set local enable_hashjoin = off`);
        await tx.execute(sql`set local enable_mergejoin = off`);
        await tx.execute(sql`set local enable_seqscan = off`);
        return (
          (await tx.execute(sql`explain (analyze, costs off, timing off) ${q1}`)).rows as {
            "QUERY PLAN": string;
          }[]
        )
          .map((r) => r["QUERY PLAN"])
          .join("\n");
      },
      { audit: false },
    );
    console.log(
      `PLAN entity match with hash/merge joins and seq scans disabled (what a large archive gets):\n${forced}`,
    );
    expect(forced).toContain("archive_entities_type_value_uq");
    const ids = (await ownerPool().query("select id from archive_entities limit 300")).rows.map(
      (r) => r.id as string,
    );
    const p2 = await plan(
      sql`select o.entity_id, count(*) from archive_observations o join archive_sources s on s.id = o.source_id and s.tombstoned_at is null where o.entity_id = any(${arr(ids, "uuid")}) group by o.entity_id`,
    );
    console.log(`PLAN prior observations:\n${p2}`);
    expect(p2).toMatch(/archive_observations_(entity_idx|triple_uq)|Seq Scan on archive_observations/);
    const p3 = await plan(
      sql`select r.id from archive_relationships r where r.a_entity_id = any(${arr(ids, "uuid")}) or r.b_entity_id = any(${arr(ids, "uuid")})`,
    );
    console.log(`PLAN relationships by endpoint:\n${p3}`);
    expect(p3).toMatch(/archive_relationships_(uq|b_idx)|Seq Scan on archive_relationships/);
  });
});
