/**
 * Read side: "what does the archive already know about these entities", relative to ONE investigation.
 * The caller (the app) loads the viewer's own entities and source URLs through withUser and passes them in; this
 * module reads ONLY archive tables and never sees a user, an investigation or a query.
 *
 * Everything is computed excluding the viewer's own sources: the archive worker may already have filed this very
 * run's findings, and "seen before" must mean "seen from somewhere other than this investigation".
 */
import { arr } from "./sqlutil";
import { sql } from "drizzle-orm";
import { getDatabase, type Database } from "@voidaccess/db";
import { canonicalUrl, canonicalize } from "./canonical";
import { TIER_RANK, tierOf, type Tier } from "./tier";

export interface ProbeEntity {
  /** the caller's own id for the entity (the bundle id), echoed back */
  key: string;
  type: string;
  /** raw value for public entities, null for sensitive ones */
  value: string | null;
  /** HMAC fingerprint for sensitive entities */
  fingerprint: string | null;
}
export interface ProbeSource {
  url: string | null;
  kind: string;
  name: string;
}
export interface Probe {
  entities: ProbeEntity[];
  ownSources: ProbeSource[];
}

export interface SeenBefore {
  archiveId: string;
  display: string;
  type: string;
  /** observations from sources other than this investigation's */
  observations: number;
  independentSources: number;
  firstSeen: string;
  lastSeen: string;
  tier: Tier;
  feedMatch: string | null;
}

export interface Neighbour {
  archiveId: string;
  type: string;
  display: string;
  tier: Tier;
  /** the relationship, as a lead */
  relationship: {
    type: string;
    evidence: number;
    independentSources: number;
    firstSeen: string;
    lastSeen: string;
    tier: Tier;
  };
  /** which of the viewer's entities it was seen alongside (probe keys) */
  via: string[];
}

export interface OfflineSource {
  url: string;
  host: string;
  kind: string;
  firstSeen: string;
  lastAlive: string;
  lastSeen: string;
  excerpt: string;
}

export interface ArchiveContext {
  /** only entities the archive has seen from elsewhere */
  seen: Record<string, SeenBefore>;
  neighbours: Neighbour[];
  offline: OfflineSource[];
  totals: { entities: number; seenBefore: number; newToArchive: number };
}

interface Resolved {
  keyToArchive: Map<string, { id: string; display: string; type: string; feedMatch: string | null }>;
  ids: string[];
  own: string[];
}

const iso = (d: unknown) => new Date(d as string).toISOString();
const lc = (t: string): Tier => (t === "feed_validated" || t === "corroborated" ? t : "unconfirmed");

async function resolve(db: Database, probe: Probe): Promise<Resolved> {
  const pubKeys: string[] = [];
  const pubTypes: string[] = [];
  const pubVals: string[] = [];
  const fpKeys: string[] = [];
  const fpTypes: string[] = [];
  const fpVals: string[] = [];
  for (const e of probe.entities) {
    if (e.fingerprint && e.value === null) {
      fpKeys.push(e.key);
      fpTypes.push(e.type);
      fpVals.push(e.fingerprint);
    } else if (e.value) {
      const c = canonicalize(e.type, e.value);
      if (!c?.canonical) continue;
      pubKeys.push(e.key);
      pubTypes.push(c.type);
      pubVals.push(c.canonical);
    }
  }
  const keyToArchive: Resolved["keyToArchive"] = new Map();
  if (pubKeys.length) {
    const r = await db.db.execute<{
      k: string;
      id: string;
      type: string;
      display_value: string;
      feed_match: string | null;
    }>(sql`
      select q.k, e.id, e.type, e.display_value, e.feed_match
      from unnest(${arr(pubKeys, "text")}, ${arr(pubTypes, "text")}, ${arr(pubVals, "text")}) as q(k, t, v)
      join archive_entities e on e.type = q.t and e.canonical_value = q.v and e.tombstoned_at is null`);
    for (const x of r.rows)
      keyToArchive.set(x.k, { id: x.id, display: x.display_value, type: x.type, feedMatch: x.feed_match });
  }
  if (fpKeys.length) {
    const r = await db.db.execute<{
      k: string;
      id: string;
      type: string;
      display_value: string;
      feed_match: string | null;
    }>(sql`
      select q.k, e.id, e.type, e.display_value, e.feed_match
      from unnest(${arr(fpKeys, "text")}, ${arr(fpTypes, "text")}, ${arr(fpVals, "text")}) as q(k, t, v)
      join archive_entities e on e.type = q.t and e.fingerprint = q.v and e.tombstoned_at is null`);
    for (const x of r.rows)
      keyToArchive.set(x.k, { id: x.id, display: x.display_value, type: x.type, feedMatch: x.feed_match });
  }
  const urls = probe.ownSources
    .map(
      (s) =>
        canonicalUrl(
          s.url ??
            `urn:${s.kind}:${
              s.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 80) || "unnamed"
            }`,
        )?.key,
    )
    .filter((u): u is string => Boolean(u));
  let own: string[] = [];
  if (urls.length) {
    const r = await db.db.execute<{ id: string }>(
      sql`select id from archive_sources where url = any(${arr(urls, "text")})`,
    );
    own = r.rows.map((x) => x.id);
  }
  return { keyToArchive, ids: [...new Set([...keyToArchive.values()].map((v) => v.id))], own };
}

/** Archive context for an investigation's entities. `only` restricts the answer to one probe key (the entity drawer). */
export async function archiveContext(
  probe: Probe,
  opts: { database?: Database; neighbourLimit?: number; only?: string } = {},
): Promise<ArchiveContext> {
  const db = opts.database ?? getDatabase();
  const limit = opts.neighbourLimit ?? 12;
  const r = await resolve(
    db,
    opts.only ? { ...probe, entities: probe.entities.filter((e) => e.key === opts.only) } : probe,
  );
  const ids = r.ids;
  const out: ArchiveContext = {
    seen: {},
    neighbours: [],
    offline: [],
    totals: { entities: probe.entities.length, seenBefore: 0, newToArchive: 0 },
  };
  if (ids.length === 0) {
    out.totals.newToArchive = probe.entities.length;
    return out;
  }

  const agg = await db.db.execute<{ entity_id: string; n: number; h: number; mn: string; mx: string }>(sql`
    select o.entity_id, count(*)::int as n, count(distinct s.host)::int as h, min(o.observed_at) as mn, max(o.observed_at) as mx
    from archive_observations o join archive_sources s on s.id = o.source_id and s.tombstoned_at is null
    where o.entity_id = any(${arr(ids, "uuid")}) and o.source_id <> all(${arr(r.own, "uuid")})
    group by o.entity_id`);
  const byId = new Map(agg.rows.map((x) => [x.entity_id, x]));
  for (const [key, a] of r.keyToArchive) {
    const x = byId.get(a.id);
    if (!x) continue;
    out.seen[key] = {
      archiveId: a.id,
      display: a.display,
      type: a.type,
      observations: Number(x.n),
      independentSources: Number(x.h),
      firstSeen: iso(x.mn),
      lastSeen: iso(x.mx),
      tier: tierOf(Number(x.h), a.feedMatch),
      feedMatch: a.feedMatch,
    };
  }
  out.totals.seenBefore = Object.keys(out.seen).length;
  out.totals.newToArchive = probe.entities.length - out.totals.seenBefore;

  const rels = await relationshipsOf(db, ids, r.own, ids, limit * 4);
  const viaById = new Map<string, string[]>();
  for (const [key, a] of r.keyToArchive) viaById.set(a.id, [...(viaById.get(a.id) ?? []), key]);
  const neighbours = new Map<string, Neighbour>();
  for (const x of rels) {
    const known = ids.includes(x.aId) ? x.aId : x.bId;
    const other =
      known === x.aId
        ? { id: x.bId, type: x.bType, display: x.bDisplay, tier: x.bTier }
        : { id: x.aId, type: x.aType, display: x.aDisplay, tier: x.aTier };
    const prev = neighbours.get(other.id);
    if (prev && prev.relationship.evidence >= x.ev) {
      prev.via = [...new Set([...prev.via, ...(viaById.get(known) ?? [])])];
      continue;
    }
    neighbours.set(other.id, {
      archiveId: other.id,
      type: other.type,
      display: other.display,
      tier: other.tier,
      relationship: {
        type: x.type,
        evidence: x.ev,
        independentSources: x.h,
        firstSeen: x.mn,
        lastSeen: x.mx,
        tier: tierOf(x.h, null),
      },
      via: viaById.get(known) ?? [],
    });
  }
  out.neighbours = [...neighbours.values()]
    .sort((a, b) => b.relationship.evidence - a.relationship.evidence)
    .slice(0, limit);

  const off = await db.db.execute<{
    url: string;
    host: string;
    kind: string;
    first_seen: string;
    last_alive: string;
    last_seen: string;
    excerpt: string;
  }>(sql`
    select s.url, s.host, s.kind, s.first_seen, s.last_alive, s.last_seen, s.excerpt
    from archive_sources s
    where s.tombstoned_at is null and s.last_alive is not null and s.last_seen > s.last_alive and s.snapshot_path is not null
      and s.id <> all(${arr(r.own, "uuid")})
      and exists (select 1 from archive_observations o where o.source_id = s.id and o.entity_id = any(${arr(ids, "uuid")}))
    order by s.last_alive desc limit 10`);
  out.offline = off.rows.map((x) => ({
    url: x.url,
    host: x.host,
    kind: x.kind,
    firstSeen: iso(x.first_seen),
    lastAlive: iso(x.last_alive),
    lastSeen: iso(x.last_seen),
    excerpt: x.excerpt,
  }));
  return out;
}

interface RelRow {
  type: string;
  aId: string;
  bId: string;
  aType: string;
  bType: string;
  aDisplay: string;
  bDisplay: string;
  aTier: Tier;
  bTier: Tier;
  ev: number;
  h: number;
  mn: string;
  mx: string;
}

/** Relationships touching `seeds`, evidence counted without the viewer's own sources, other endpoint not in `exclude`. */
async function relationshipsOf(
  db: Database,
  seeds: string[],
  own: string[],
  exclude: string[],
  limit: number,
): Promise<RelRow[]> {
  const res = await db.db.execute<Record<string, unknown>>(sql`
    select r.type, r.a_entity_id, r.b_entity_id,
           ea.type as a_type, eb.type as b_type, ea.display_value as a_display, eb.display_value as b_display,
           ea.tier::text as a_tier, eb.tier::text as b_tier,
           count(rs.source_id)::int as ev, count(distinct s.host)::int as h,
           min(s.first_seen) as mn, max(coalesce(s.last_alive, s.last_seen)) as mx
    from archive_relationships r
    join archive_relationship_sources rs on rs.relationship_id = r.id
    join archive_sources s on s.id = rs.source_id and s.tombstoned_at is null
    join archive_entities ea on ea.id = r.a_entity_id and ea.tombstoned_at is null
    join archive_entities eb on eb.id = r.b_entity_id and eb.tombstoned_at is null
    where (r.a_entity_id = any(${arr(seeds, "uuid")}) or r.b_entity_id = any(${arr(seeds, "uuid")}))
      and not (r.a_entity_id = any(${arr(exclude, "uuid")}) and r.b_entity_id = any(${arr(exclude, "uuid")}))
      and rs.source_id <> all(${arr(own, "uuid")})
    group by r.id, ea.id, eb.id
    order by ev desc limit ${limit}`);
  return res.rows.map((x) => ({
    type: String(x.type),
    aId: String(x.a_entity_id),
    bId: String(x.b_entity_id),
    aType: String(x.a_type),
    bType: String(x.b_type),
    aDisplay: String(x.a_display),
    bDisplay: String(x.b_display),
    aTier: lc(String(x.a_tier)),
    bTier: lc(String(x.b_tier)),
    ev: Number(x.ev),
    h: Number(x.h),
    mn: iso(x.mn),
    mx: iso(x.mx),
  }));
}

export interface ArchiveGraphNode {
  /** "arc:<uuid>" */
  id: string;
  type: string;
  label: string;
  tier: Tier;
  hop: 1 | 2;
}
export interface ArchiveGraphEdge {
  /** probe key for the viewer's entities, "arc:<uuid>" for archive-only nodes */
  source: string;
  target: string;
  type: string;
  evidence: number;
  independentSources: number;
  firstSeen: string;
  lastSeen: string;
  tier: Tier;
}
export interface ArchiveGraph {
  nodes: ArchiveGraphNode[];
  edges: ArchiveGraphEdge[];
  truncated: boolean;
}

export const GRAPH_CAPS = { hop1: 60, hop2: 80, total: 140 } as const;

/** Archive neighbours one hop (or two, capped) from the viewer's entities, each edge a lead with evidence and dates. */
export async function archiveGraph(
  probe: Probe,
  opts: { database?: Database; hops?: 1 | 2; minTier?: Tier } = {},
): Promise<ArchiveGraph> {
  const db = opts.database ?? getDatabase();
  const r = await resolve(db, probe);
  const min = TIER_RANK[opts.minTier ?? "unconfirmed"];
  const keyOf = new Map<string, string>();
  for (const [key, a] of r.keyToArchive) if (!keyOf.has(a.id)) keyOf.set(a.id, key);
  const nodes = new Map<string, ArchiveGraphNode>();
  const edges: ArchiveGraphEdge[] = [];
  let truncated = false;

  const take = async (seeds: string[], exclude: string[], hop: 1 | 2, cap: number) => {
    if (seeds.length === 0) return [] as string[];
    const rels = (await relationshipsOf(db, seeds, r.own, exclude, cap * 3)).filter(
      (x) => TIER_RANK[tierOf(x.h, null)] >= min,
    );
    const added: string[] = [];
    for (const x of rels) {
      const seedIsA = seeds.includes(x.aId);
      const other = seedIsA
        ? { id: x.bId, type: x.bType, display: x.bDisplay, tier: x.bTier }
        : { id: x.aId, type: x.aType, display: x.aDisplay, tier: x.aTier };
      if (exclude.includes(other.id) && !seeds.includes(other.id)) continue;
      const nodeId = `arc:${other.id}`;
      if (!nodes.has(nodeId)) {
        if (nodes.size >= GRAPH_CAPS.total || added.length >= cap) {
          truncated = true;
          continue;
        }
        nodes.set(nodeId, { id: nodeId, type: other.type, label: other.display, tier: other.tier, hop });
        added.push(other.id);
      }
      const mapEnd = (id: string) => keyOf.get(id) ?? `arc:${id}`;
      edges.push({
        source: mapEnd(x.aId),
        target: mapEnd(x.bId),
        type: x.type,
        evidence: x.ev,
        independentSources: x.h,
        firstSeen: x.mn,
        lastSeen: x.mx,
        tier: tierOf(x.h, null),
      });
    }
    return added;
  };

  const hop1 = await take(r.ids, r.ids, 1, GRAPH_CAPS.hop1);
  if ((opts.hops ?? 1) === 2 && hop1.length) await take(hop1, [...r.ids, ...hop1], 2, GRAPH_CAPS.hop2);
  return { nodes: [...nodes.values()], edges, truncated };
}
