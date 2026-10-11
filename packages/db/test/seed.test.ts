import { describe, expect, it } from "vitest";
import { seed } from "../src/seed";
import { appDb, ownerPool } from "./helpers";

describe("seed", () => {
  it("creates a free and a pro user with sample investigations whose entities are scoped to their owner", async () => {
    const res = await seed(appDb(), "test-fp-key");
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.investigations.length)).toEqual([1, 2]);
    for (const r of res) {
      const { rows } = await ownerPool().query(
        `select count(*)::int n, count(*) filter (where user_id <> $1)::int foreign_rows
         from inv_entities where investigation_id = any($2)`,
        [r.userId, r.investigations],
      );
      expect(rows[0].n).toBeGreaterThan(100);
      expect(rows[0].foreign_rows).toBe(0);
    }
    const sensitive = await ownerPool().query(
      `select count(*)::int n from inv_entities where sensitive and value is not null`,
    );
    expect(sensitive.rows[0].n).toBe(0); // raw sensitive values never land in snapshot tables
  });
});
