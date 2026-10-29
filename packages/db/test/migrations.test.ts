import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../src/migrate";
import { makeUser, ownerPool } from "./helpers";

/** The statements of a drizzle migration file, in order. */
const statements = (file: string) =>
  readFileSync(`${MIGRATIONS_FOLDER}/${file}`, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^--.*$/gm, "").trim())
    .filter(Boolean);

describe("H1-4: run_events status data migration", () => {
  it("rewrites legacy stage_* rows to type stage + status, is idempotent, and leaves other rows alone", async () => {
    const u = await makeUser("pro");
    const run = randomUUID();
    const owner = ownerPool();
    await owner.query(
      `insert into investigations (id, user_id, query, depth) values ($1, $2, 'q', 'quick')`,
      [run, u],
    );
    const legacy: [number, string, string | null][] = [
      [1, "stage", "refine"], // legacy start
      [2, "stage_end", "refine"],
      [3, "stage_skipped", "fetch"],
      [4, "stage_failed", "extract"],
      [5, "counts", null],
      [6, "completed", null],
    ];
    for (const [seq, type, stage] of legacy)
      await owner.query(
        `insert into run_events (run_id, user_id, seq, type, stage, at) values ($1,$2,$3,$4,$5,now())`,
        [run, u, seq, type, stage],
      );

    const dataStatements = statements("0008_h1_run_events_status.sql").filter((s) =>
      /^UPDATE run_events/i.test(s),
    );
    expect(dataStatements.length).toBe(2);
    const read = async () =>
      (
        await owner.query(`select seq, type, stage, status from run_events where run_id = $1 order by seq`, [
          run,
        ])
      ).rows;
    const expected = [
      { seq: 1, type: "stage", stage: "refine", status: "start" },
      { seq: 2, type: "stage", stage: "refine", status: "end" },
      { seq: 3, type: "stage", stage: "fetch", status: "skipped" },
      { seq: 4, type: "stage", stage: "extract", status: "failed" },
      { seq: 5, type: "counts", stage: null, status: null },
      { seq: 6, type: "completed", stage: null, status: null },
    ];
    for (let pass = 0; pass < 2; pass++) {
      for (const s of dataStatements) await owner.query(s);
      expect(await read(), `pass ${pass + 1}`).toEqual(expected);
    }
    // the readable shape is unchanged: the same stage names are "completed"
    const done = await owner.query(
      `select stage from run_events where run_id=$1 and type='stage' and status='end'`,
      [run],
    );
    expect(done.rows).toEqual([{ stage: "refine" }]);
  });

  it("the status column only accepts the four engine values", async () => {
    const u = await makeUser("pro");
    const run = randomUUID();
    await ownerPool().query(
      `insert into investigations (id, user_id, query, depth) values ($1, $2, 'q', 'quick')`,
      [run, u],
    );
    await expect(
      ownerPool().query(
        `insert into run_events (run_id, user_id, seq, type, status, at) values ($1,$2,1,'stage','bogus',now())`,
        [run, u],
      ),
    ).rejects.toThrow(/run_events_status_check/);
  });
});

describe("22T: relevance tier columns (0015)", () => {
  it("applies over existing snapshot rows without rewriting them (immutability triggers never fire)", async () => {
    const u = await makeUser("pro");
    const inv = randomUUID();
    const client = await ownerPool().connect();
    try {
      await client.query("begin");
      // back to the 0014 shape, with a snapshot row ingested before the migration
      await client.query(`alter table inv_entities drop column relevance, drop column relevance_reason`);
      await client.query(`alter table inv_relationships drop column relevance`);
      await client.query(
        `alter table inv_sources drop column relevance, drop column relevance_reason, drop column page_kind`,
      );
      await client.query(`alter table inv_summary drop column relevance`);
      await client.query(
        `insert into investigations (id, user_id, query, depth) values ($1, $2, 'q', 'quick')`,
        [inv, u],
      );
      await client.query(
        `insert into inv_entities (user_id, investigation_id, bundle_id, type, display_value, confidence)
         values ($1, $2, 'e1', 'CVE', 'CVE-2024-3400', 0.9)`,
        [u, inv],
      );
      await client.query(
        `insert into inv_sources (user_id, investigation_id, bundle_id, kind, name, fetched_at)
         values ($1, $2, 's1', 'feed', 'kev', now())`,
        [u, inv],
      );
      for (const s of statements("0015_v22_relevance_tiers.sql")) await client.query(s);
      const r = await client.query(
        `select e.relevance e, e.relevance_reason er, s.relevance s, s.page_kind pk
           from inv_entities e join inv_sources s using (investigation_id) where e.investigation_id = $1`,
        [inv],
      );
      expect(r.rows).toEqual([{ e: null, er: null, s: null, pk: null }]);
      await expect(
        client.query(`update inv_entities set relevance = 'direct' where investigation_id = $1`, [inv]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
