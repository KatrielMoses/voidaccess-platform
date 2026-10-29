import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ResultBundle, checkTrace, validateJsonSchema } from "./index";

const schema = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "schemas", "ResultBundle.json"), "utf8"),
) as Record<string, unknown>;

const at = "2026-10-29T10:00:00.000Z";
const metrics = {
  duration_ms: 1,
  tor_bootstrap_ms: 1,
  stage_ms: {},
  llm_calls: 0,
  llm_tokens_in: 0,
  llm_tokens_out: 0,
  llm_cost_usd: 0,
  pages_fetched: 2,
  bytes_fetched: 1,
  enrichment_calls: {},
};
const ent = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "RANSOMWARE_GROUP",
  value: "lockbit",
  display_value: "lockbit",
  sensitive: false,
  confidence: 0.8,
  source_ids: ["s1"],
  tags: [],
  ...extra,
});
const legacy = {
  schema_version: 1,
  run_id: "r1",
  query: "lockbit ransomware",
  refined_queries: [],
  depth: "quick",
  started_at: at,
  completed_at: at,
  engine_version: "2.1.1",
  summary: { markdown: "m", key_findings: [], risk_notes: [], confidence: "low", source_count: 1 },
  entities: [ent("e1"), { ...ent("e2"), value: "fbi", display_value: "fbi", type: "ORGANIZATION_NAME" }],
  relationships: [
    { source: "e1", target: "e2", type: "CO_APPEARED_ON", weight: 0.5, evidence_source_ids: [] },
  ],
  actors: [],
  communities: [],
  sources: [{ id: "s1", kind: "onion_page", name: "x.onion", url: null, fetched_at: at, excerpt: "" }],
  metrics,
};
const tiered = {
  ...legacy,
  engine_version: "2.2.0",
  entities: [
    ent("e1", { relevance: "direct", relevance_reason: "query_entity" }),
    {
      ...ent("e2", { relevance: "background", relevance_reason: "agency_not_near_match" }),
      value: "fbi",
      display_value: "fbi",
      type: "ORGANIZATION_NAME",
    },
  ],
  relationships: [{ ...legacy.relationships[0], relevance: "background" }],
  sources: [
    {
      ...legacy.sources[0],
      relevance: "direct",
      relevance_reason: "term_match:lockbit",
      page_kind: "leak_post",
    },
  ],
  relevance: {
    query_intent: "named_threat",
    pages: { direct: 1, related: 0, background: 0 },
    entities: { direct: 1, related: 0, background: 1 },
    relationships: { direct: 0, related: 0, background: 1 },
    removed: { gazetteer_context: 2, org_boilerplate: 0 },
    feed_items_capped: 0,
    filter_fallback: false,
    refined_query_restored: false,
  },
};

describe("contract v0.4 relevance tiers", () => {
  it("a bundle without tiers (older engine) is still valid", () => {
    expect(ResultBundle.safeParse(legacy).success).toBe(true);
    expect(validateJsonSchema(schema, legacy)).toEqual([]);
  });
  it("a tiered bundle is valid in zod and in the committed JSON Schema", () => {
    expect(ResultBundle.safeParse(tiered).success).toBe(true);
    expect(validateJsonSchema(schema, tiered)).toEqual([]);
  });
  it("rejects an unknown tier, an unknown page kind and an oversized reason", () => {
    const badTier = {
      ...tiered,
      entities: [{ ...tiered.entities[0], relevance: "noise" }, tiered.entities[1]],
    };
    const badKind = { ...tiered, sources: [{ ...tiered.sources[0], page_kind: "blog" }] };
    const longReason = {
      ...tiered,
      sources: [{ ...tiered.sources[0], relevance_reason: "x".repeat(121) }],
    };
    for (const b of [badTier, badKind, longReason]) {
      expect(ResultBundle.safeParse(b).success).toBe(false);
      expect(validateJsonSchema(schema, b)).not.toEqual([]);
    }
  });
  it("the summary object is complete when present", () => {
    const { filter_fallback: _drop, ...partial } = tiered.relevance;
    expect(ResultBundle.safeParse({ ...tiered, relevance: partial }).success).toBe(false);
    expect(validateJsonSchema(schema, { ...tiered, relevance: partial })).not.toEqual([]);
  });
});

describe("filter_fallback trace kind", () => {
  const tr = (data: Record<string, unknown>) => ({
    type: "trace",
    schema: 2,
    run_id: "r1",
    seq: 3,
    at,
    stage: "filter",
    kind: "filter_fallback",
    data,
  });
  it("is accepted with counts only", () => {
    const r = checkTrace(tr({ scope: "clearnet", candidates: 12, kept: 12 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.data).toEqual({ scope: "clearnet", candidates: 12, kept: 12 });
  });
  it("is rejected when malformed", () => {
    expect(checkTrace(tr({ scope: "web", candidates: 1, kept: 1 })).ok).toBe(false);
    expect(checkTrace(tr({ scope: "onion", candidates: -1, kept: 1 })).ok).toBe(false);
  });
});
