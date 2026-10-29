import { z } from "zod";
import { Depth, EntityType } from "./entities";
import { RunMetrics } from "./metrics";

const iso = z.iso.datetime({ offset: true });

export const SourceKind = z.enum(["tor_search", "onion_page", "paste", "code_forge", "feed", "enrichment"]);
export type SourceKind = z.infer<typeof SourceKind>;

/**
 * Contract v0.4 (engine 2.2, sub-phase 22R): how an item relates to the query. Every tier field is OPTIONAL, so a
 * bundle from an older engine (no tiers) stays valid and renders exactly as before.
 *   direct     - it mentions the query (the selector, the threat name or an alias, the topic, the person/org)
 *   related    - no direct mention, but a part of the selector, a known relation or a refined-query term
 *   background - collected, but not about the query (kept and labelled, never hidden)
 */
export const RELEVANCE_TIERS = ["direct", "related", "background"] as const;
export const Relevance = z.enum(RELEVANCE_TIERS);
export type Relevance = z.infer<typeof Relevance>;

/** The engine's page classification (unknown values are mapped to `other` by the runner). */
export const PAGE_KINDS = [
  "directory",
  "search_portal",
  "market_listing",
  "forum_thread",
  "leak_post",
  "paste",
  "news_article",
  "feed_item",
  "other",
] as const;
export const PageKind = z.enum(PAGE_KINDS);
export type PageKind = z.infer<typeof PageKind>;

/** Machine reason for a tier, e.g. `term_match:lockbit`, `near_direct_match`, `none`. Bounded, never page text. */
export const RelevanceReason = z.string().min(1).max(120);

const TierCount = z.number().int().nonnegative();
export const TierCounts = z.object({ direct: TierCount, related: TierCount, background: TierCount });
export type TierCounts = z.infer<typeof TierCounts>;

/** Run-level relevance summary. Counts describe what the BUNDLE contains (after the runner's safety gate and caps). */
export const BundleRelevance = z.object({
  /** selector | named_threat | person_or_org | topic */
  query_intent: z.string().min(1).max(40),
  pages: TierCounts,
  entities: TierCounts,
  relationships: TierCounts,
  /** the only removals the engine's tiering makes (counts only) */
  removed: z.object({ gazetteer_context: TierCount, org_boilerplate: TierCount }),
  /** recent RSS articles that matched no query term and were left out beyond the engine's cap */
  feed_items_capped: TierCount,
  /** the LLM relevance filter returned nothing usable, so every candidate was kept */
  filter_fallback: z.boolean(),
  /** the LLM rewrite dropped the selector or name, so the original query was searched instead */
  refined_query_restored: z.boolean(),
});
export type BundleRelevance = z.infer<typeof BundleRelevance>;

export const BundleEntity = z.object({
  id: z.string().min(1),
  type: EntityType,
  /** Canonical value. For secrets: `len:N sha256:<8-hex prefix>` (never the raw value). */
  value: z.string(),
  /** Pre-masked for display, e.g. `j***@acme.com`. */
  display_value: z.string(),
  sensitive: z.boolean(),
  confidence: z.number().min(0).max(1),
  first_seen: iso.optional(),
  source_ids: z.array(z.string()),
  tags: z.array(z.string()),
  relevance: Relevance.optional(),
  relevance_reason: RelevanceReason.optional(),
});
export type BundleEntity = z.infer<typeof BundleEntity>;

export const BundleRelationship = z.object({
  source: z.string(),
  target: z.string(),
  /** e.g. CO_APPEARED_ON, TARGETS, EXPLOITS, DROPS, USES, COMMUNICATES_WITH, CONTROLS */
  type: z.string(),
  weight: z.number().min(0).max(1),
  evidence_source_ids: z.array(z.string()),
  relevance: Relevance.optional(),
});
export type BundleRelationship = z.infer<typeof BundleRelationship>;

export const BundleActor = z.object({
  id: z.string().min(1),
  handle: z.string(),
  aliases: z.array(z.string()),
  entity_ids: z.array(z.string()),
  first_seen: iso.optional(),
  last_seen: iso.optional(),
  summary: z.string().optional(),
});
export type BundleActor = z.infer<typeof BundleActor>;

export const BundleCommunity = z.object({
  id: z.number().int().nonnegative(),
  entity_ids: z.array(z.string()),
  label: z.string().optional(),
});
export type BundleCommunity = z.infer<typeof BundleCommunity>;

export const BundleSource = z.object({
  id: z.string().min(1),
  kind: SourceKind,
  name: z.string(),
  url: z.string().nullable(),
  fetched_at: iso,
  /** Sanitized; contract limit 500 chars (fixtures keep it to 200). */
  excerpt: z.string().max(500),
  relevance: Relevance.optional(),
  relevance_reason: RelevanceReason.optional(),
  page_kind: PageKind.optional(),
});
export type BundleSource = z.infer<typeof BundleSource>;

export const BundleSummary = z.object({
  markdown: z.string(),
  key_findings: z.array(z.string()),
  risk_notes: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  source_count: z.number().int().nonnegative(),
  /** How the summary was produced (the engine's `summary_kind`, e.g. llm or fallback). Optional. */
  summary_kind: z.string().optional(),
});
export type BundleSummary = z.infer<typeof BundleSummary>;

export const ResultBundle = z.object({
  schema_version: z.literal(1),
  run_id: z.string().min(1),
  query: z.string(),
  refined_queries: z.array(z.string()),
  depth: Depth,
  started_at: iso,
  completed_at: iso,
  engine_version: z.string(),
  summary: BundleSummary,
  entities: z.array(BundleEntity),
  relationships: z.array(BundleRelationship),
  actors: z.array(BundleActor),
  communities: z.array(BundleCommunity),
  sources: z.array(BundleSource),
  metrics: RunMetrics,
  /** v0.4: absent on bundles from engines before 2.2 */
  relevance: BundleRelevance.optional(),
});
export type ResultBundle = z.infer<typeof ResultBundle>;

/** Referential integrity checks the JSON Schema cannot express. Returns a list of problems. */
export function checkBundleIntegrity(b: ResultBundle): string[] {
  const problems: string[] = [];
  const entityIds = new Set(b.entities.map((e) => e.id));
  const sourceIds = new Set(b.sources.map((s) => s.id));
  if (entityIds.size !== b.entities.length) problems.push("duplicate entity ids");
  for (const e of b.entities) {
    for (const s of e.source_ids) if (!sourceIds.has(s)) problems.push(`entity ${e.id}: unknown source ${s}`);
  }
  for (const r of b.relationships) {
    if (!entityIds.has(r.source) || !entityIds.has(r.target))
      problems.push(`relationship ${r.source}->${r.target}: unknown entity`);
    for (const s of r.evidence_source_ids)
      if (!sourceIds.has(s)) problems.push(`relationship: unknown source ${s}`);
  }
  for (const a of b.actors)
    for (const id of a.entity_ids)
      if (!entityIds.has(id)) problems.push(`actor ${a.id}: unknown entity ${id}`);
  for (const c of b.communities)
    for (const id of c.entity_ids)
      if (!entityIds.has(id)) problems.push(`community ${c.id}: unknown entity ${id}`);
  return problems;
}
