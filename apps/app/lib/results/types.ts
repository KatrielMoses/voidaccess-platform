/** JSON-serialisable shapes shared by server queries, API routes and client components. */

/** Contract v0.4 relevance tier (engine 2.2). Null on investigations ingested from older bundles. */
export type Tier = "direct" | "related" | "background";
export const TIERS: readonly Tier[] = ["direct", "related", "background"];
export type TierCounts = Record<Tier, number>;

/** Run-level relevance summary (inv_summary.relevance). */
export interface RelevanceView {
  queryIntent: string;
  pages: TierCounts;
  entities: TierCounts;
  relationships: TierCounts;
  removed: { gazetteerContext: number; orgBoilerplate: number };
  feedItemsCapped: number;
  filterFallback: boolean;
  refinedQueryRestored: boolean;
}

export interface SummaryStats {
  entities: number;
  relationships: number;
  typedRelationships: number;
  actors: number;
  sources: number;
  sensitiveEntities: number;
  durationMs: number;
  engineVersion: string;
  refinedQueries: string[];
  startedAt: string;
  completedAt: string;
}

export interface InvestigationView {
  id: string;
  query: string;
  depth: string;
  status: string;
  creditsCharged: number;
  createdAt: string;
  completedAt: string | null;
  summaryKind: string | null;
  refinedQueries: string[];
  summary: {
    markdown: string;
    keyFindings: string[];
    riskNotes: string[];
    confidence: string;
    sourceCount: number;
    entityCounts: Record<string, number>;
    stats: SummaryStats | null;
  };
  /** null for investigations without tiers: every view then renders exactly as before */
  relevance: RelevanceView | null;
}

export interface EntityRowView {
  bundleId: string;
  type: string;
  displayValue: string;
  sensitive: boolean;
  confidence: number;
  firstSeen: string | null;
  sourceCount: number;
  tags: string[];
  degree: number;
  relevance: Tier | null;
  relevanceReason: string | null;
}

export type EntitySort = "value" | "type" | "confidence" | "firstSeen" | "sources" | "degree";

export interface EntityQuery {
  q?: string;
  types?: string[];
  minConfidence?: number;
  maxConfidence?: number;
  sensitiveOnly?: boolean;
  /** restrict to one relevance tier */
  tier?: Tier;
  /** restrict by bundle id (the archive "seen before" filter); an empty include list matches nothing */
  bundleIds?: { include?: string[]; exclude?: string[] };
  sort?: EntitySort;
  dir?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface EntityPage {
  rows: EntityRowView[];
  total: number;
}

export interface SourceView {
  bundleId: string;
  kind: string;
  name: string;
  url: string | null;
  fetchedAt: string;
  excerpt: string;
  relevance: Tier | null;
  relevanceReason: string | null;
  pageKind: string | null;
}

export interface RelationshipView {
  type: string;
  weight: number;
  direction: "out" | "in";
  other: { bundleId: string; type: string; displayValue: string; sensitive: boolean };
  evidence: SourceView[];
}

export interface EntityDetail {
  bundleId: string;
  type: string;
  displayValue: string;
  sensitive: boolean;
  confidence: number;
  firstSeen: string | null;
  tags: string[];
  degree: number;
  community: number | null;
  relevance: Tier | null;
  relevanceReason: string | null;
  sources: SourceView[];
  relationships: RelationshipView[];
  actors: { bundleId: string; handle: string }[];
}

/** Compact graph payload: node and edge tuples keep 5,000 nodes / 15,000 edges small. */
export type GraphNodeTuple = [
  id: string,
  type: string,
  label: string,
  confidence: number,
  degree: number,
  community: number | null,
  sensitive: 0 | 1,
  /** visible tags (search matches them, P9-4) */
  tags?: string[],
];
export type GraphEdgeTuple = [source: string, target: string, type: string, weight: number];
export interface GraphData {
  nodes: GraphNodeTuple[];
  edges: GraphEdgeTuple[];
  communities: { id: number; label: string | null; size: number }[];
}

export interface ActorView {
  bundleId: string;
  handle: string;
  aliases: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  summary: string | null;
  entityCount: number;
  entities: { bundleId: string; type: string; displayValue: string; sensitive: boolean }[];
  sources: { bundleId: string; kind: string; name: string }[];
}

export interface SnapshotForExport {
  investigation: InvestigationView;
  entities: (EntityRowView & { value: string | null; community: number | null })[];
  relationships: {
    sourceBundleId: string;
    targetBundleId: string;
    type: string;
    weight: number;
    evidenceSourceIds: string[];
    relevance: Tier | null;
  }[];
  actors: ActorView[];
  sources: SourceView[];
}
