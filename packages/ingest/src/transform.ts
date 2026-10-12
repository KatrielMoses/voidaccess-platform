/**
 * Pure bundle -> rows transform: validation-agnostic (callers validate first), no I/O.
 * This is where masking happens, so a raw sensitive value can never reach an inv_* row.
 */
import {
  fingerprint,
  isSecretType,
  isSensitiveType,
  maskCredential,
  maskEntityValue,
  maskPartial,
  normalizeValue,
  type BundleEntity,
  type ResultBundle,
} from "@voidaccess/engine-client";

const SECRET_TOKEN = /^len:(\d+) sha256:[0-9a-f]{8}$/;

export interface EntityRow {
  bundleId: string;
  type: string;
  value: string | null;
  displayValue: string;
  fingerprint: string | null;
  sensitive: boolean;
  confidence: number;
  firstSeen: Date | null;
  sourceIds: string[];
  tags: string[];
  degree: number;
  community: number | null;
  searchText: string;
}

export interface VaultItem {
  bundleId: string;
  type: string;
  value: string;
}

export interface RelationshipRow {
  sourceBundleId: string;
  targetBundleId: string;
  type: string;
  weight: number;
  evidenceSourceIds: string[];
}

export interface ActorRow {
  bundleId: string;
  handle: string;
  aliases: string[];
  entityBundleIds: string[];
  firstSeen: Date | null;
  lastSeen: Date | null;
  summary: string | null;
}

export interface SourceRow {
  bundleId: string;
  kind: string;
  name: string;
  url: string | null;
  fetchedAt: Date;
  excerpt: string;
}

export interface Transformed {
  entities: EntityRow[];
  vault: VaultItem[];
  relationships: RelationshipRow[];
  actors: ActorRow[];
  sources: SourceRow[];
  summary: {
    markdown: string;
    keyFindings: string[];
    riskNotes: string[];
    confidence: string;
    sourceCount: number;
    communities: Array<{ id: number; entity_ids: string[]; label?: string }>;
    entityCounts: Record<string, number>;
    stats: {
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
    };
  };
  /** Replaces any raw sensitive value in free text (used for export artifacts too). */
  scrub: (text: string) => string;
}

const date = (s: string | undefined) => (s ? new Date(s) : null);
const uniq = <T>(xs: T[]) => [...new Set(xs)];

interface Masked {
  sensitive: boolean;
  value: string | null;
  display: string;
  fp: string | null;
  vaultValue: string | null;
  /** raw strings to scrub from free text (never the token form) */
  rawForScrub: string | null;
}

function maskEntity(e: BundleEntity, key: string): Masked {
  const sensitive = e.sensitive || isSensitiveType(e.type);
  if (!sensitive)
    return {
      sensitive,
      value: e.value,
      display: e.display_value || e.value,
      fp: null,
      vaultValue: null,
      rawForScrub: null,
    };
  const secret = isSecretType(e.type);
  const token = SECRET_TOKEN.exec(e.value);
  if (secret && token) {
    // already redacted by the runner: len:N sha256:<prefix>. Nothing raw exists to protect or vault.
    return {
      sensitive,
      value: null,
      display: `len:${token[1]}`,
      fp: fingerprint(key, e.type, e.value),
      vaultValue: null,
      rawForScrub: null,
    };
  }
  const raw = e.value;
  let display = secret ? maskCredential(raw) : maskEntityValue(e.type, raw);
  if (display === raw) display = maskPartial(raw);
  return {
    sensitive,
    value: null,
    display,
    fp: fingerprint(key, e.type, raw),
    vaultValue: raw,
    rawForScrub: raw,
  };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function transformBundle(b: ResultBundle, opts: { fingerprintKey: string }): Transformed {
  const key = opts.fingerprintKey;

  // 1. mask + dedupe entities within the run
  const canonical = new Map<string, string>(); // bundle id -> canonical bundle id
  const byKey = new Map<string, EntityRow>();
  const order: EntityRow[] = [];
  const vault: VaultItem[] = [];
  const displayByRaw = new Map<string, string>();

  for (const e of b.entities) {
    const m = maskEntity(e, key);
    const dedupeKey = m.fp
      ? `${e.type}\u0000fp:${m.fp}`
      : `${e.type}\u0000${normalizeValue(e.type, e.value)}`;
    const existing = byKey.get(dedupeKey);
    if (existing) {
      canonical.set(e.id, existing.bundleId);
      existing.confidence = Math.max(existing.confidence, e.confidence);
      existing.sourceIds = uniq([...existing.sourceIds, ...e.source_ids]);
      existing.tags = uniq([...existing.tags, ...e.tags]);
      const fs = date(e.first_seen);
      if (fs && (!existing.firstSeen || fs < existing.firstSeen)) existing.firstSeen = fs;
      continue;
    }
    canonical.set(e.id, e.id);
    if (m.vaultValue !== null) vault.push({ bundleId: e.id, type: e.type, value: m.vaultValue });
    if (m.rawForScrub && m.rawForScrub.length >= 4) displayByRaw.set(m.rawForScrub, m.display);
    const row: EntityRow = {
      bundleId: e.id,
      type: e.type,
      value: m.value,
      displayValue: m.display,
      fingerprint: m.fp,
      sensitive: m.sensitive,
      confidence: e.confidence,
      firstSeen: date(e.first_seen),
      sourceIds: uniq(e.source_ids),
      tags: uniq(e.tags),
      degree: 0,
      community: null,
      searchText: "",
    };
    byKey.set(dedupeKey, row);
    order.push(row);
  }

  // scrub: raw sensitive values replaced by their masked form in every free-text field we store
  let scrubRe: RegExp | null = null;
  if (displayByRaw.size > 0) {
    const alts = [...displayByRaw.keys()].sort((a, b2) => b2.length - a.length).map(escapeRe);
    scrubRe = new RegExp(alts.join("|"), "g");
  }
  const scrub = (t: string) => (scrubRe ? t.replace(scrubRe, (m) => displayByRaw.get(m) ?? "***") : t);

  // 2. relationships remapped to canonical ids, self-loops dropped, duplicates merged
  const relMap = new Map<string, RelationshipRow>();
  for (const r of b.relationships) {
    const s = canonical.get(r.source) ?? r.source;
    const t = canonical.get(r.target) ?? r.target;
    if (s === t) continue;
    const k = `${s}\u0000${t}\u0000${r.type}`;
    const ex = relMap.get(k);
    if (ex) {
      ex.weight = Math.max(ex.weight, r.weight);
      ex.evidenceSourceIds = uniq([...ex.evidenceSourceIds, ...r.evidence_source_ids]);
    } else
      relMap.set(k, {
        sourceBundleId: s,
        targetBundleId: t,
        type: r.type,
        weight: r.weight,
        evidenceSourceIds: uniq(r.evidence_source_ids),
      });
  }
  const relationships = [...relMap.values()];

  // 3. degree, community, search text
  const degree = new Map<string, number>();
  for (const r of relationships) {
    degree.set(r.sourceBundleId, (degree.get(r.sourceBundleId) ?? 0) + 1);
    degree.set(r.targetBundleId, (degree.get(r.targetBundleId) ?? 0) + 1);
  }
  const communities = b.communities.map((c) => ({
    ...c,
    entity_ids: uniq(c.entity_ids.map((id) => canonical.get(id) ?? id)),
  }));
  const communityOf = new Map<string, number>();
  for (const c of communities)
    for (const id of c.entity_ids) if (!communityOf.has(id)) communityOf.set(id, c.id);
  const entityCounts: Record<string, number> = {};
  for (const r of order) {
    r.degree = degree.get(r.bundleId) ?? 0;
    r.community = communityOf.get(r.bundleId) ?? null;
    r.tags = r.tags.map(scrub);
    r.searchText = `${r.displayValue} ${r.tags.join(" ")}`.toLowerCase();
    entityCounts[r.type] = (entityCounts[r.type] ?? 0) + 1;
  }

  // 4. actors, sources, summary
  const actors: ActorRow[] = b.actors.map((a) => ({
    bundleId: a.id,
    handle: scrub(a.handle),
    aliases: a.aliases.map(scrub),
    entityBundleIds: uniq(a.entity_ids.map((id) => canonical.get(id) ?? id)),
    firstSeen: date(a.first_seen),
    lastSeen: date(a.last_seen),
    summary: a.summary ? scrub(a.summary) : null,
  }));
  const sources: SourceRow[] = b.sources.map((s) => ({
    bundleId: s.id,
    kind: s.kind,
    name: scrub(s.name),
    url: s.url,
    fetchedAt: new Date(s.fetched_at),
    excerpt: scrub(s.excerpt).slice(0, 500),
  }));
  const typed = relationships.filter((r) => r.type !== "CO_APPEARED_ON").length;
  return {
    entities: order,
    vault,
    relationships,
    actors,
    sources,
    summary: {
      markdown: scrub(b.summary.markdown),
      keyFindings: b.summary.key_findings.map(scrub),
      riskNotes: b.summary.risk_notes.map(scrub),
      confidence: b.summary.confidence,
      sourceCount: b.summary.source_count,
      communities,
      entityCounts,
      stats: {
        entities: order.length,
        relationships: relationships.length,
        typedRelationships: typed,
        actors: actors.length,
        sources: sources.length,
        sensitiveEntities: order.filter((e) => e.sensitive).length,
        durationMs: b.metrics.duration_ms,
        engineVersion: b.engine_version,
        refinedQueries: b.refined_queries.map(scrub),
        startedAt: b.started_at,
        completedAt: b.completed_at,
      },
    },
    scrub,
  };
}
