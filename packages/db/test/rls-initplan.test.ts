import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerUrl } from "./urls";

// Every RLS policy that calls app_user_id() must wrap it as (SELECT app_user_id()), so Postgres evaluates the signed
// context check once per statement (an InitPlan) instead of once per row.
describe("RLS policies evaluate app_user_id() once per statement", () => {
  let c: pg.Client;
  beforeAll(async () => {
    c = new pg.Client({ connectionString: ownerUrl });
    await c.connect();
  });
  afterAll(() => c.end());

  it("wraps every app_user_id() call in a sub-select", async () => {
    const { rows } = await c.query<{ policyname: string; tablename: string; expr: string }>(
      `SELECT policyname, tablename, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
       FROM pg_policies WHERE schemaname = 'public'
         AND (coalesce(qual, '') LIKE '%app_user_id()%' OR coalesce(with_check, '') LIKE '%app_user_id()%')`,
    );
    expect(rows.length).toBeGreaterThan(10);
    const bare = rows.filter((r) => r.expr.replace(/SELECT app_user_id\(\)/g, "").includes("app_user_id()"));
    expect(bare.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([]);
  });
});
