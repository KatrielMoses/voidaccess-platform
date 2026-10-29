import { afterAll, describe, expect, it } from "vitest";
import { ingestBundle, transformBundle } from "../src";
import { bundleDeps, fixtureBundle, withTiers } from "../src/test-support";
import { appDb, makeInvestigation, makeUser, ownerPool } from "./helpers";

const database = appDb();
afterAll(async () => {
  await database.close();
  await ownerPool().end();
});

describe("transformBundle: relevance tiers (contract v0.4)", () => {
  it("leaves every tier null for a bundle without tiers", () => {
    const t = transformBundle(fixtureBundle("lockbit-deep", false), { fingerprintKey: "k" });
    expect(t.summary.relevance).toBeNull();
    expect(t.entities.every((e) => e.relevance === null && e.relevanceReason === null)).toBe(true);
    expect(t.sources.every((s) => s.relevance === null && s.pageKind === null)).toBe(true);
    expect(t.relationships.every((r) => r.relevance === null)).toBe(true);
  });

  it("carries tiers, reasons and page kinds, and counts what it stores", () => {
    const b = withTiers(fixtureBundle("lockbit-deep", false));
    const t = transformBundle(b, { fingerprintKey: "k" });
    const s = t.summary.relevance!;
    expect(s.queryIntent).toBe("named_threat");
    expect(s.feedItemsCapped).toBe(169);
    expect(s.entities.direct + s.entities.related + s.entities.background).toBe(t.entities.length);
    expect(s.pages.direct + s.pages.related + s.pages.background).toBe(t.sources.length);
    expect(s.entities.direct).toBeGreaterThan(0);
    const direct = t.entities.find((e) => e.relevance === "direct")!;
    expect(direct.relevanceReason).toMatch(/query_entity|near_direct_match/);
    expect(t.sources[0]!.pageKind).toBe("leak_post");
    expect(t.sources[0]!.relevanceReason).toBe("term_match:lockbit");
  });

  it("a merged value keeps its strongest tier, and an edge is never stronger than its ends", () => {
    const b = withTiers(fixtureBundle("lockbit-deep", false));
    const bg = b.entities.find((e) => e.relevance === "background")!;
    b.entities.push({ ...bg, id: "dup-direct", relevance: "direct", relevance_reason: "selector_entity" });
    const other = b.entities.find((e) => e.relevance === "background" && e.id !== bg.id)!;
    b.relationships.push({
      source: "dup-direct",
      target: other.id,
      type: "CO_APPEARED_ON",
      weight: 0.3,
      evidence_source_ids: [],
      relevance: "direct", // claims more than its ends allow
    });
    const t = transformBundle(b, { fingerprintKey: "k" });
    const merged = t.entities.find((e) => e.bundleId === bg.id)!;
    expect(merged.relevance).toBe("direct");
    expect(merged.relevanceReason).toBe("selector_entity");
    const edge = t.relationships.find((r) => r.sourceBundleId === bg.id && r.targetBundleId === other.id)!;
    expect(edge.relevance).toBe("background");
  });
});

describe("ingestBundle: relevance tiers", () => {
  it("writes the tier columns and the run summary", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    await ingestBundle(runId, bundleDeps(withTiers(fixtureBundle("lockbit-deep", true))), { database });
    const q = (sql: string) =>
      ownerPool()
        .query(sql, [id])
        .then((r) => r.rows);
    const ents = await q(
      `select relevance, count(*)::int n from inv_entities where investigation_id=$1 group by 1 order by 1`,
    );
    expect(ents.map((r) => r.relevance)).toEqual(["background", "direct", "related"]);
    const src = await q(
      `select relevance, relevance_reason, page_kind from inv_sources where investigation_id=$1 and relevance='direct' limit 1`,
    );
    expect(src[0]).toMatchObject({ relevance: "direct", page_kind: expect.any(String) });
    const rels = await q(
      `select count(*)::int n from inv_relationships where investigation_id=$1 and relevance is null`,
    );
    expect(rels[0].n).toBe(0);
    const [sum] = await q(`select relevance from inv_summary where investigation_id=$1`);
    const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    const [n] = await q(`select count(*)::int n from inv_entities where investigation_id=$1`);
    expect(total(sum.relevance.entities)).toBe(n.n);
    expect(sum.relevance.filterFallback).toBe(false);
  });

  it("an older bundle stores null tiers", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    await ingestBundle(runId, bundleDeps(fixtureBundle("lockbit-deep", false)), { database });
    const r = await ownerPool().query(
      `select (select count(*)::int from inv_entities where investigation_id=$1 and relevance is not null) e,
              (select count(*)::int from inv_sources where investigation_id=$1 and relevance is not null) s,
              (select relevance from inv_summary where investigation_id=$1) sum`,
      [id],
    );
    expect(r.rows[0]).toEqual({ e: 0, s: 0, sum: null });
  });

  it("the database refuses a tier outside the contract, and snapshot rows stay immutable", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    await ingestBundle(runId, bundleDeps(withTiers(fixtureBundle("lockbit-deep", false))), { database });
    await expect(
      ownerPool().query(
        `insert into inv_sources (user_id, investigation_id, bundle_id, kind, name, fetched_at, relevance)
         values ($1, $2, 'x', 'feed', 'x', now(), 'noise')`,
        [user, id],
      ),
    ).rejects.toThrow(/inv_sources_relevance_check/);
    await expect(
      ownerPool().query(`update inv_entities set relevance='direct' where investigation_id=$1`, [id]),
    ).rejects.toThrow(/immutable/);
  });
});
