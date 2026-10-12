import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateBundle } from "@voidaccess/ingest/test-support";
import { appDb, makeUser, ownerPool, seedInvestigation } from "./results-helpers";

let user: string;
let inv: string;
beforeAll(async () => {
  user = await makeUser("pro");
  inv = await seedInvestigation(user, generateBundle());
  // a realistic multi-tenant table: 6 other users with 5,000 entities each, so the planner sees ~35k rows
  for (let i = 0; i < 6; i++)
    await seedInvestigation(await makeUser("pro"), generateBundle({ seed: 100 + i }));
  await ownerPool().query("analyze inv_entities");
});
afterAll(async () => {
  await appDb().close();
  await ownerPool().end();
});

async function plan(query: ReturnType<typeof sql>, opts: { noSeqScan?: boolean } = {}) {
  return appDb().withUser(user, async (tx) => {
    if (opts.noSeqScan) await tx.execute(sql`set local enable_seqscan = off`);
    const r = await tx.execute(sql`explain (analyze, costs off, timing off) ${query}`);
    return (r.rows as { "QUERY PLAN": string }[]).map((x) => x["QUERY PLAN"]).join("\n");
  });
}

describe("entity search plan, 5,000 entities, under RLS", () => {
  const q = (term: string) =>
    sql`select bundle_id from inv_entities where investigation_id = ${inv} and search_text like ${"%" + term + "%"} order by confidence desc limit 100`;

  it("is served by Postgres, fast, with the trigram index in place", async () => {
    const idx = await ownerPool().query(
      "select indexdef from pg_indexes where indexname = 'inv_entities_search_trgm_idx'",
    );
    expect(idx.rows[0].indexdef).toContain("gin_trgm_ops");
    const def = await plan(q("host-3a"));
    const forced = await plan(q("host-3a"), { noSeqScan: true });
    console.log(
      `PLAN (default planner), term 'host-3a', ~35k rows in table:\n${def}\n\nPLAN (enable_seqscan=off):\n${forced}`,
    );
    const t0 = performance.now();
    const rows = await appDb().withUser(user, (tx) => tx.execute(q("host-3a")));
    const ms = Math.round(performance.now() - t0);
    console.log(`search 'host-3a' wall time incl. transaction: ${ms} ms, ${rows.rows.length} rows`);
    expect(ms).toBeLessThan(500);
  });
});
