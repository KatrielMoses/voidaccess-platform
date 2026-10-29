import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fixtureBundle, withTiers } from "@voidaccess/ingest/test-support";
import { appDb, makeUser, ownerPool, seedInvestigation } from "./results-helpers";

let current: string | null = null;
vi.mock("@/lib/dev-session", () => ({ getSessionUserId: async () => current }));
vi.mock("@voidaccess/db", async (orig) => {
  const mod = await orig<typeof import("@voidaccess/db")>();
  return { ...mod, getDatabase: () => appDb() };
});

import { GET as entitiesGET } from "@/app/api/investigations/[id]/entities/route";
import { GET as exportGET } from "@/app/api/investigations/[id]/exports/[format]/route";
import { getInvestigation, getSources, loadSnapshot, searchEntities } from "@/lib/results/queries";
import { entitiesCsv, sourcesCsv } from "@/lib/results/exports";
import type { EntityPage } from "@/lib/results/types";

let U: string, tiered: string, legacy: string, noDirect: string;
beforeAll(async () => {
  U = await makeUser("pro");
  tiered = await seedInvestigation(U, withTiers(fixtureBundle("lockbit-deep", false)));
  legacy = await seedInvestigation(U, fixtureBundle("lockbit-deep", false));
  noDirect = await seedInvestigation(U, withTiers(fixtureBundle("lockbit-deep", false), { direct: false }));
  current = U;
});
afterAll(async () => {
  await appDb().close();
  await ownerPool().end();
});

const idp = (id: string, format = "") =>
  ({ params: Promise.resolve({ id, format, bundleId: "" }) }) as {
    params: Promise<{ id: string; format: string; bundleId: string }>;
  };

describe("relevance tiers through the results queries", () => {
  it("a tiered investigation exposes the run summary; a legacy one exposes null", async () => {
    const t = await getInvestigation(U, tiered, { database: appDb() });
    expect(t!.relevance).toMatchObject({ queryIntent: "named_threat", filterFallback: false });
    expect(t!.relevance!.entities.direct).toBeGreaterThan(0);
    const l = await getInvestigation(U, legacy, { database: appDb() });
    expect(l!.relevance).toBeNull();
    const n = await getInvestigation(U, noDirect, { database: appDb() });
    expect(n!.relevance!.entities.direct).toBe(0);
    expect(n!.relevance!.pages.direct).toBe(0);
    expect(n!.relevance!.filterFallback).toBe(true);
  });

  it("filters entities by tier, and the per-tier totals equal the summary counts", async () => {
    const inv = (await getInvestigation(U, tiered, { database: appDb() }))!;
    for (const tier of ["direct", "related", "background"] as const) {
      const page = await searchEntities(U, tiered, { tier, limit: 500 }, { database: appDb() });
      expect(page!.total).toBe(inv.relevance!.entities[tier]);
      expect(page!.rows.every((r) => r.relevance === tier)).toBe(true);
    }
  });

  it("the entities route reads ?tier= and ignores an unknown tier", async () => {
    const one = (await (
      await entitiesGET(new Request("http://localhost/x?tier=direct&limit=500"), idp(tiered))
    ).json()) as EntityPage;
    expect(one.rows.length).toBeGreaterThan(0);
    expect(one.rows.every((r) => r.relevance === "direct")).toBe(true);
    const all = (await (
      await entitiesGET(new Request("http://localhost/x?tier=noise&limit=1"), idp(tiered))
    ).json()) as EntityPage;
    expect(all.total).toBe((await searchEntities(U, tiered, {}, { database: appDb() }))!.total);
  });

  it("sources carry tier, reason and page kind; legacy sources carry nulls", async () => {
    const s = (await getSources(U, tiered, { database: appDb() }))!;
    expect(s.some((x) => x.relevance === "direct" && x.pageKind && x.relevanceReason)).toBe(true);
    const l = (await getSources(U, legacy, { database: appDb() }))!;
    expect(l.every((x) => x.relevance === null && x.pageKind === null)).toBe(true);
  });
});

describe("exports include the tier", () => {
  it("CSV has relevance columns (filled when tiered, empty for legacy)", async () => {
    const snap = (await loadSnapshot(U, tiered, { database: appDb() }))!;
    const csv = entitiesCsv(snap).split("\r\n");
    expect(csv[0]).toMatch(/,relevance,relevance_reason$/);
    expect(csv.slice(1).some((l) => /,direct,(query_entity|near_direct_match)$/.test(l))).toBe(true);
    expect(sourcesCsv(snap).split("\r\n")[0]).toBe(
      "id,kind,name,url,fetched_at,excerpt,relevance,relevance_reason,page_kind",
    );
    const old = (await loadSnapshot(U, legacy, { database: appDb() }))!;
    expect(entitiesCsv(old).split("\r\n")[1]).toMatch(/,,$/);
  });

  it("the JSON and CSV routes carry tiers end to end", async () => {
    const json = JSON.parse(
      await (await exportGET(new Request("http://localhost/x"), idp(tiered, "json"))).text(),
    );
    expect(json.relevance.queryIntent).toBe("named_threat");
    expect(json.entities.every((e: { relevance: string }) => typeof e.relevance === "string")).toBe(true);
    expect(json.sources[0]).toHaveProperty("page_kind");
    expect(json.relationships[0]).toHaveProperty("relevance");
    const legacyJson = JSON.parse(
      await (await exportGET(new Request("http://localhost/x"), idp(legacy, "json"))).text(),
    );
    expect(legacyJson.relevance).toBeNull();
    const zip = unzipSync(
      new Uint8Array(
        await (await exportGET(new Request("http://localhost/x"), idp(tiered, "csv"))).arrayBuffer(),
      ),
    );
    expect(strFromU8(zip["relationships.csv"]!).split("\r\n")[0]).toMatch(/,relevance$/);
    expect(strFromU8(zip["README.txt"]!)).toContain("background = collected, not about the query");
  });
});
