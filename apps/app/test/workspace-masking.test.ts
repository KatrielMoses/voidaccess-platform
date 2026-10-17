import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureBundle, rawSensitiveList } from "@voidaccess/ingest/test-support";
import { GROUPS } from "@/lib/results/categories";
import { getGraph, searchEntities } from "@/lib/results/queries";
import { buildIndex, searchIndex } from "@/lib/results/search";
import { rowsByGroup } from "@/lib/results/workspace-model";
import { appDb, makeUser, ownerPool, seedInvestigation } from "./results-helpers";

/**
 * P9 G2/A2/A7: the workspace shows exactly what the entities table shows. Every sidebar value is the same masked
 * display value the table returns for that entity, every entity is in exactly one group, and search never sees an
 * unmasked value. Both reads go through the user's RLS path (withUser); another user gets nothing.
 */
const bundle = fixtureBundle("blackcat-standard-onion", true);
let A: string, B: string, inv: string;

beforeAll(async () => {
  A = await makeUser("pro");
  B = await makeUser("pro");
  inv = await seedInvestigation(A, bundle);
});
afterAll(async () => {
  await appDb().close();
  await ownerPool().end();
});

describe("results workspace data", () => {
  it("masking is identical to the entities table, value for value", async () => {
    const ctx = { database: appDb() };
    const graph = (await getGraph(A, inv, ctx))!;
    const table = new Map<string, { display: string; sensitive: boolean }>();
    for (let offset = 0; ; offset += 500) {
      const page = (await searchEntities(A, inv, { offset, limit: 500 }, ctx))!;
      for (const r of page.rows) table.set(r.bundleId, { display: r.displayValue, sensitive: r.sensitive });
      if (offset + 500 >= page.total) break;
    }
    expect(graph.nodes.length).toBe(table.size);
    for (const [id, , label, , , , sensitive] of graph.nodes) {
      expect(table.get(id), id).toEqual({ display: label, sensitive: sensitive === 1 });
    }
  });

  it("every entity is in exactly one sidebar group, and group counts sum to the entity count", async () => {
    const graph = (await getGraph(A, inv, { database: appDb() }))!;
    const groups = rowsByGroup(graph);
    const ids = GROUPS.flatMap((g) => groups.get(g.id)!.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(graph.nodes.length);
    expect(ids.length).toBe(bundle.entities.length);
  });

  it("search only ever sees masked values: no raw sensitive value is findable", async () => {
    const graph = (await getGraph(A, inv, { database: appDb() }))!;
    const idx = buildIndex([...rowsByGroup(graph).values()].flat());
    const raw = rawSensitiveList();
    expect(raw.length).toBeGreaterThan(0);
    for (const secret of raw) {
      // the full raw value never matches (a masked form may share a short prefix, never the whole value)
      if (secret.length >= 6) expect(searchIndex(idx, secret).size, secret).toBe(0);
    }
    expect(JSON.stringify(graph)).not.toContain(raw.find((r) => r.length >= 6)!);
  });

  it("another user gets nothing (RLS path)", async () => {
    expect(await getGraph(B, inv, { database: appDb() })).toBeNull();
  });
});
