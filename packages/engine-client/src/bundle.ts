import { z } from "zod";
import { Depth, EntityType } from "./entities";
import { RunMetrics } from "./metrics";

const iso = z.iso.datetime({ offset: true });

export const SourceKind = z.enum(["tor_search", "onion_page", "paste", "code_forge", "feed", "enrichment"]);
export type SourceKind = z.infer<typeof SourceKind>;

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
});
export type BundleEntity = z.infer<typeof BundleEntity>;

export const BundleRelationship = z.object({
  source: z.string(),
  target: z.string(),
  /** e.g. CO_APPEARED_ON, TARGETS, EXPLOITS, DROPS, USES, COMMUNICATES_WITH, CONTROLS */
  type: z.string(),
  weight: z.number().min(0).max(1),
  evidence_source_ids: z.array(z.string()),
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
});
export type BundleSource = z.infer<typeof BundleSource>;

export const BundleSummary = z.object({
  markdown: z.string(),
  key_findings: z.array(z.string()),
  risk_notes: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  source_count: z.number().int().nonnegative(),
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
