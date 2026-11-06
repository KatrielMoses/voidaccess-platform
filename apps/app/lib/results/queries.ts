/**
 * Every read goes through withUser(userId, …): Postgres RLS scopes it to the signed-in user, so another
 * user's investigation id simply returns nothing (callers answer 404). No function accepts a user id from
 * the client; routes take it from the session.
 *
 * PREVIEW LOCK (lib/access): the exported readers at the bottom of this file are the ONE choke point for report data.
 * Each reads the real rows (read* below, already masked by the existing safety rules), then applies the caller's
 * report access: full access gets exactly the same payload plus `access: {level:"full"}`; a preview account gets the
 * lib/access redactor output (placeholders built from positions only) or PreviewLockedError (exports, entity detail).
 */
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import {
  getDatabase,
  invActors,
  invEntities,
  invExports,
  invRelationships,
  invSources,
  invSummary,
  investigations,
  users,
  type Database,
} from "@voidaccess/db";
import type { PlanId } from "@voidaccess/config";
import {
  PREVIEW_PLACEHOLDER_ROWS,
  PREVIEW_ROWS,
  PreviewLockedError,
  accessMarker,
  getReportAccess,
  redactActors,
  redactEntityPage,
  redactGraph,
  redactInvestigation,
  redactSources,
  type AccessMarker,
  type GraphPayload,
  type InvestigationPayload,
} from "@/lib/access";
import type {
  ActorView,
  EntityDetail,
  EntityPage,
  EntityQuery,
  EntityRowView,
  GraphData,
  InvestigationView,
  SnapshotForExport,
  SourceView,
  Tier,
} from "./types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QueryCtx {
  /** tests inject a Database; defaults to the DATABASE_URL singleton (va_app role, RLS applies) */
  database?: Database;
}
const dbOf = (c?: QueryCtx) => c?.database ?? getDatabase();
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function getPlanId(userId: string, ctx?: QueryCtx): Promise<PlanId> {
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [u] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
    return (u?.plan ?? "free") as PlanId;
  });
}

/** The investigation header + summary, or null if it doesn't exist, isn't yours, or has no snapshot yet. */
async function readInvestigation(
  userId: string,
  id: string,
  ctx?: QueryCtx,
): Promise<InvestigationView | null> {
  if (!UUID_RE.test(id)) return null;
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ inv: investigations, sum: invSummary })
      .from(investigations)
      .innerJoin(invSummary, eq(invSummary.investigationId, investigations.id))
      .where(eq(investigations.id, id))
      .limit(1);
    if (!row) return null;
    const { inv, sum } = row;
    return {
      id: inv.id,
      query: inv.query,
      depth: inv.depth,
      status: inv.status,
      creditsCharged: inv.creditsCharged,
      createdAt: inv.createdAt.toISOString(),
      completedAt: iso(inv.completedAt),
      summaryKind: inv.summaryKind,
      refinedQueries: sum.stats?.refinedQueries ?? inv.refinedQueries,
      summary: {
        markdown: sum.markdown,
        keyFindings: sum.keyFindings,
        riskNotes: sum.riskNotes,
        confidence: sum.confidence,
        sourceCount: sum.sourceCount,
        entityCounts: sum.entityCounts,
        stats: sum.stats,
      },
      relevance: sum.relevance ?? null,
    };
  });
}

const entityCols = {
  bundleId: invEntities.bundleId,
  type: invEntities.type,
  displayValue: invEntities.displayValue,
  sensitive: invEntities.sensitive,
  confidence: invEntities.confidence,
  firstSeen: invEntities.firstSeen,
  sourceIds: invEntities.sourceIds,
  tags: invEntities.tags,
  degree: invEntities.degree,
  relevance: invEntities.relevance,
  relevanceReason: invEntities.relevanceReason,
};

/** The column is CHECK-constrained to the three tiers; anything else reads as no tier. */
const asTier = (v: string | null): Tier | null =>
  v === "direct" || v === "related" || v === "background" ? v : null;

function toRow(r: {
  bundleId: string;
  type: string;
  displayValue: string;
  sensitive: boolean;
  confidence: number;
  firstSeen: Date | null;
  sourceIds: string[];
  tags: string[];
  degree: number;
  relevance: string | null;
  relevanceReason: string | null;
}): EntityRowView {
  return {
    bundleId: r.bundleId,
    type: r.type,
    displayValue: r.displayValue,
    sensitive: r.sensitive,
    confidence: r.confidence,
    firstSeen: iso(r.firstSeen),
    sourceCount: r.sourceIds.length,
    tags: r.tags,
    degree: r.degree,
    relevance: asTier(r.relevance),
    relevanceReason: r.relevanceReason,
  };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const SORTS = {
  value: invEntities.displayValue,
  type: invEntities.type,
  confidence: invEntities.confidence,
  firstSeen: invEntities.firstSeen,
  sources: sql`cardinality(${invEntities.sourceIds})`,
  degree: invEntities.degree,
} as const;

export const ENTITY_PAGE_MAX = 500;

/** Filtered, sorted, paged entity search served by Postgres (trigram index on search_text). */
async function readEntities(
  userId: string,
  id: string,
  q: EntityQuery,
  ctx?: QueryCtx,
): Promise<EntityPage | null> {
  if (!UUID_RE.test(id)) return null;
  const limit = Math.min(Math.max(q.limit ?? 100, 1), ENTITY_PAGE_MAX);
  const offset = Math.max(q.offset ?? 0, 0);
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [exists] = await tx
      .select({ id: investigations.id })
      .from(investigations)
      .where(eq(investigations.id, id))
      .limit(1);
    if (!exists) return null;
    const where: SQL[] = [eq(invEntities.investigationId, id)];
    const term = q.q?.trim().toLowerCase();
    if (term) where.push(sql`${invEntities.searchText} like ${"%" + likeEscape(term) + "%"}`);
    if (q.types?.length) where.push(inArray(invEntities.type, q.types));
    if (q.minConfidence !== undefined) where.push(gte(invEntities.confidence, q.minConfidence));
    if (q.maxConfidence !== undefined) where.push(lte(invEntities.confidence, q.maxConfidence));
    if (q.sensitiveOnly) where.push(eq(invEntities.sensitive, true));
    if (q.tier) where.push(eq(invEntities.relevance, q.tier));
    if (q.bundleIds?.include) {
      if (q.bundleIds.include.length === 0) return { rows: [], total: 0 };
      where.push(inArray(invEntities.bundleId, q.bundleIds.include));
    }
    if (q.bundleIds?.exclude?.length) where.push(notInArray(invEntities.bundleId, q.bundleIds.exclude));
    const sortCol = SORTS[q.sort ?? "confidence"];
    const dir =
      (q.dir ??
        (q.sort && q.sort !== "confidence" && q.sort !== "degree" && q.sort !== "sources"
          ? "asc"
          : "desc")) === "asc"
        ? asc
        : desc;
    const cond = and(...where);
    const [rows, [count]] = await Promise.all([
      tx
        .select(entityCols)
        .from(invEntities)
        .where(cond)
        .orderBy(dir(sortCol), asc(invEntities.displayValue), asc(invEntities.bundleId))
        .limit(limit)
        .offset(offset),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(invEntities)
        .where(cond),
    ]);
    return { rows: rows.map(toRow), total: count?.n ?? 0 };
  });
}

function toSource(s: {
  bundleId: string;
  kind: string;
  name: string;
  url: string | null;
  fetchedAt: Date;
  excerpt: string;
  relevance: string | null;
  relevanceReason: string | null;
  pageKind: string | null;
}): SourceView {
  return {
    bundleId: s.bundleId,
    kind: s.kind,
    name: s.name,
    url: s.url,
    fetchedAt: s.fetchedAt.toISOString(),
    excerpt: s.excerpt,
    relevance: asTier(s.relevance),
    relevanceReason: s.relevanceReason,
    pageKind: s.pageKind,
  };
}

const sourceCols = {
  bundleId: invSources.bundleId,
  kind: invSources.kind,
  name: invSources.name,
  url: invSources.url,
  fetchedAt: invSources.fetchedAt,
  excerpt: invSources.excerpt,
  relevance: invSources.relevance,
  relevanceReason: invSources.relevanceReason,
  pageKind: invSources.pageKind,
};

async function readSources(userId: string, id: string, ctx?: QueryCtx): Promise<SourceView[] | null> {
  if (!UUID_RE.test(id)) return null;
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [exists] = await tx
      .select({ id: investigations.id })
      .from(investigations)
      .where(eq(investigations.id, id))
      .limit(1);
    if (!exists) return null;
    const rows = await tx
      .select(sourceCols)
      .from(invSources)
      .where(eq(invSources.investigationId, id))
      .orderBy(asc(invSources.fetchedAt), asc(invSources.bundleId));
    return rows.map(toSource);
  });
}

async function readEntityDetail(
  userId: string,
  id: string,
  bundleId: string,
  ctx?: QueryCtx,
): Promise<EntityDetail | null> {
  if (!UUID_RE.test(id)) return null;
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [e] = await tx
      .select({ ...entityCols, community: invEntities.community })
      .from(invEntities)
      .where(and(eq(invEntities.investigationId, id), eq(invEntities.bundleId, bundleId)))
      .limit(1);
    if (!e) return null;
    const rels = await tx
      .select()
      .from(invRelationships)
      .where(
        and(
          eq(invRelationships.investigationId, id),
          sql`(${invRelationships.sourceBundleId} = ${bundleId} or ${invRelationships.targetBundleId} = ${bundleId})`,
        ),
      )
      .orderBy(desc(invRelationships.weight));
    const otherIds = [
      ...new Set(rels.map((r) => (r.sourceBundleId === bundleId ? r.targetBundleId : r.sourceBundleId))),
    ];
    const others = otherIds.length
      ? await tx
          .select({
            bundleId: invEntities.bundleId,
            type: invEntities.type,
            displayValue: invEntities.displayValue,
            sensitive: invEntities.sensitive,
          })
          .from(invEntities)
          .where(and(eq(invEntities.investigationId, id), inArray(invEntities.bundleId, otherIds)))
      : [];
    const otherMap = new Map(others.map((o) => [o.bundleId, o]));
    const srcIds = [...new Set([...e.sourceIds, ...rels.flatMap((r) => r.evidenceSourceIds)])];
    const srcRows = srcIds.length
      ? await tx
          .select(sourceCols)
          .from(invSources)
          .where(and(eq(invSources.investigationId, id), inArray(invSources.bundleId, srcIds)))
      : [];
    const srcMap = new Map(srcRows.map((s) => [s.bundleId, toSource(s)]));
    const actors = await tx
      .select({ bundleId: invActors.bundleId, handle: invActors.handle })
      .from(invActors)
      .where(and(eq(invActors.investigationId, id), sql`${bundleId} = any(${invActors.entityBundleIds})`));
    return {
      ...toRow(e),
      community: e.community,
      sources: e.sourceIds.map((s) => srcMap.get(s)).filter((s): s is SourceView => Boolean(s)),
      relationships: rels.flatMap((r) => {
        const outgoing = r.sourceBundleId === bundleId;
        const o = otherMap.get(outgoing ? r.targetBundleId : r.sourceBundleId);
        if (!o) return [];
        return [
          {
            type: r.type,
            weight: r.weight,
            direction: outgoing ? ("out" as const) : ("in" as const),
            other: o,
            evidence: r.evidenceSourceIds
              .map((s) => srcMap.get(s))
              .filter((s): s is SourceView => Boolean(s)),
          },
        ];
      }),
      actors,
    };
  });
}

async function readGraph(userId: string, id: string, ctx?: QueryCtx): Promise<GraphData | null> {
  if (!UUID_RE.test(id)) return null;
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [sum] = await tx
      .select({ communities: invSummary.communities })
      .from(invSummary)
      .where(eq(invSummary.investigationId, id))
      .limit(1);
    if (!sum) return null;
    const [nodes, edges] = await Promise.all([
      tx
        .select({
          id: invEntities.bundleId,
          type: invEntities.type,
          label: invEntities.displayValue,
          confidence: invEntities.confidence,
          degree: invEntities.degree,
          community: invEntities.community,
          sensitive: invEntities.sensitive,
          tags: invEntities.tags,
        })
        .from(invEntities)
        .where(eq(invEntities.investigationId, id)),
      tx
        .select({
          s: invRelationships.sourceBundleId,
          t: invRelationships.targetBundleId,
          type: invRelationships.type,
          w: invRelationships.weight,
        })
        .from(invRelationships)
        .where(eq(invRelationships.investigationId, id)),
    ]);
    const size = new Map<number, number>();
    for (const n of nodes) if (n.community !== null) size.set(n.community, (size.get(n.community) ?? 0) + 1);
    return {
      nodes: nodes.map((n) => [
        n.id,
        n.type,
        n.label,
        n.confidence,
        n.degree,
        n.community,
        n.sensitive ? 1 : 0,
        n.tags,
      ]),
      edges: edges.map((e) => [e.s, e.t, e.type, e.w]),
      communities: sum.communities
        .map((c) => ({ id: c.id, label: c.label ?? null, size: size.get(c.id) ?? 0 }))
        .filter((c) => c.size > 0),
    };
  });
}

async function readActors(userId: string, id: string, ctx?: QueryCtx): Promise<ActorView[] | null> {
  if (!UUID_RE.test(id)) return null;
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [exists] = await tx
      .select({ id: investigations.id })
      .from(investigations)
      .where(eq(investigations.id, id))
      .limit(1);
    if (!exists) return null;
    const actors = await tx
      .select()
      .from(invActors)
      .where(eq(invActors.investigationId, id))
      .orderBy(asc(invActors.handle));
    const ids = [...new Set(actors.flatMap((a) => a.entityBundleIds))];
    const ents = ids.length
      ? await tx
          .select({
            bundleId: invEntities.bundleId,
            type: invEntities.type,
            displayValue: invEntities.displayValue,
            sensitive: invEntities.sensitive,
            sourceIds: invEntities.sourceIds,
          })
          .from(invEntities)
          .where(and(eq(invEntities.investigationId, id), inArray(invEntities.bundleId, ids)))
      : [];
    const entMap = new Map(ents.map((e) => [e.bundleId, e]));
    const srcIds = [...new Set(ents.flatMap((e) => e.sourceIds))];
    const srcs = srcIds.length
      ? await tx
          .select({ bundleId: invSources.bundleId, kind: invSources.kind, name: invSources.name })
          .from(invSources)
          .where(and(eq(invSources.investigationId, id), inArray(invSources.bundleId, srcIds)))
      : [];
    const srcMap = new Map(srcs.map((s) => [s.bundleId, s]));
    return actors.map((a) => {
      const linked = a.entityBundleIds
        .map((b) => entMap.get(b))
        .filter((e): e is NonNullable<typeof e> => Boolean(e));
      const sIds = [...new Set(linked.flatMap((e) => e.sourceIds))];
      return {
        bundleId: a.bundleId,
        handle: a.handle,
        aliases: a.aliases,
        firstSeen: iso(a.firstSeen),
        lastSeen: iso(a.lastSeen),
        summary: a.summary,
        entityCount: linked.length,
        entities: linked.map(({ bundleId, type, displayValue, sensitive }) => ({
          bundleId,
          type,
          displayValue,
          sensitive,
        })),
        sources: sIds.map((s) => srcMap.get(s)).filter((s): s is NonNullable<typeof s> => Boolean(s)),
      };
    });
  });
}

/** Which runner artifacts were stored at ingest (STIX, MISP, Sigma, YARA, Snort, Suricata). */
async function readArtifactFormats(userId: string, id: string, ctx?: QueryCtx): Promise<string[] | null> {
  if (!UUID_RE.test(id)) return null;
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [exists] = await tx
      .select({ id: investigations.id })
      .from(investigations)
      .where(eq(investigations.id, id))
      .limit(1);
    if (!exists) return null;
    const rows = await tx
      .select({ format: invExports.format })
      .from(invExports)
      .where(eq(invExports.investigationId, id));
    return rows.map((r) => r.format);
  });
}

async function readArtifact(
  userId: string,
  id: string,
  format: string,
  ctx?: QueryCtx,
): Promise<{ bytes: Buffer } | null> {
  if (!UUID_RE.test(id)) return null;
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ content: invExports.content })
      .from(invExports)
      .where(and(eq(invExports.investigationId, id), eq(invExports.format, format)))
      .limit(1);
    return row?.content ? { bytes: row.content } : null;
  });
}

/** Everything needed by the CSV/JSON/Markdown/IOC exports, in one RLS-scoped transaction. */
async function readSnapshot(userId: string, id: string, ctx?: QueryCtx): Promise<SnapshotForExport | null> {
  const investigation = await readInvestigation(userId, id, ctx);
  if (!investigation) return null;
  const [entities, relationships, actors, sources] = await Promise.all([
    dbOf(ctx).withUser(userId, (tx) =>
      tx
        .select({ ...entityCols, value: invEntities.value, community: invEntities.community })
        .from(invEntities)
        .where(eq(invEntities.investigationId, id))
        .orderBy(asc(invEntities.type), asc(invEntities.displayValue)),
    ),
    dbOf(ctx).withUser(userId, (tx) =>
      tx
        .select({
          sourceBundleId: invRelationships.sourceBundleId,
          targetBundleId: invRelationships.targetBundleId,
          type: invRelationships.type,
          weight: invRelationships.weight,
          evidenceSourceIds: invRelationships.evidenceSourceIds,
          relevance: invRelationships.relevance,
        })
        .from(invRelationships)
        .where(eq(invRelationships.investigationId, id)),
    ),
    readActors(userId, id, ctx),
    readSources(userId, id, ctx),
  ]);
  return {
    investigation,
    entities: entities.map((e) => ({ ...toRow(e), value: e.value, community: e.community })),
    relationships: relationships.map((r) => ({ ...r, relevance: asTier(r.relevance) })),
    actors: actors ?? [],
    sources: sources ?? [],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Report readers with the preview lock applied (the only exported way to read report data).

/** The investigation header + summary with its `access` marker; null if missing, not yours, or no snapshot yet. */
export async function getInvestigation(
  userId: string,
  id: string,
  ctx?: QueryCtx,
): Promise<InvestigationPayload | null> {
  const inv = await readInvestigation(userId, id, ctx);
  if (!inv) return null;
  const access = await accessMarker(userId, id, ctx);
  return access.level === "full" ? { ...inv, access } : redactInvestigation(inv, access.totals);
}

/**
 * Entity search. A preview account always gets the first PREVIEW_ROWS rows of the unfiltered default order plus
 * placeholders, whatever the filters (with real totals, filters would be a search oracle over locked values).
 */
export async function searchEntities(
  userId: string,
  id: string,
  q: EntityQuery,
  ctx?: QueryCtx,
): Promise<(EntityPage & { access: AccessMarker }) | null> {
  if (!UUID_RE.test(id)) return null;
  const access = await accessMarker(userId, id, ctx);
  if (access.level === "full") {
    const page = await readEntities(userId, id, q, ctx);
    return page ? { ...page, access } : null;
  }
  const first = await readEntities(userId, id, { limit: PREVIEW_ROWS + PREVIEW_PLACEHOLDER_ROWS }, ctx);
  return first ? redactEntityPage(first.rows, access.totals, q.offset ?? 0) : null;
}

/** Sources in fetch order. Arrays carry no `access` field: read it from getInvestigation(...).access. */
export async function getSources(userId: string, id: string, ctx?: QueryCtx): Promise<SourceView[] | null> {
  const rows = await readSources(userId, id, ctx);
  if (!rows) return null;
  return (await getReportAccess(userId, id, ctx)) === "full" ? rows : redactSources(rows);
}

/** Actors by handle. Arrays carry no `access` field: read it from getInvestigation(...).access. */
export async function getActors(userId: string, id: string, ctx?: QueryCtx): Promise<ActorView[] | null> {
  const rows = await readActors(userId, id, ctx);
  if (!rows) return null;
  return (await getReportAccess(userId, id, ctx)) === "full" ? rows : redactActors(rows);
}

/** Entity detail. Throws PreviewLockedError for a preview account (all detail is locked, visible rows included). */
export async function getEntityDetail(
  userId: string,
  id: string,
  bundleId: string,
  ctx?: QueryCtx,
): Promise<(EntityDetail & { access: AccessMarker }) | null> {
  const d = await readEntityDetail(userId, id, bundleId, ctx);
  if (!d) return null;
  if ((await getReportAccess(userId, id, ctx)) !== "full") throw new PreviewLockedError();
  return { ...d, access: { level: "full" } };
}

/** The graph; a preview account gets the shape only (opaque shuffled ids, no labels). */
export async function getGraph(userId: string, id: string, ctx?: QueryCtx): Promise<GraphPayload | null> {
  const g = await readGraph(userId, id, ctx);
  if (!g) return null;
  const access = await accessMarker(userId, id, ctx);
  return access.level === "full" ? { ...g, access: { level: "full" } } : redactGraph(g, access.totals);
}

export interface ArtifactFormats {
  /** runner artifacts stored at ingest (STIX, MISP, Sigma, YARA, Snort, Suricata) */
  formats: string[];
  /** true for a preview account: every export is locked (402), the list is still sent so the UI can show them */
  locked: boolean;
  access: AccessMarker;
}

export async function listArtifactFormats(
  userId: string,
  id: string,
  ctx?: QueryCtx,
): Promise<ArtifactFormats | null> {
  const formats = await readArtifactFormats(userId, id, ctx);
  if (!formats) return null;
  const access = await accessMarker(userId, id, ctx);
  return { formats, locked: access.level !== "full", access };
}

/** A stored runner artifact. Throws PreviewLockedError for a preview account. */
export async function getArtifact(
  userId: string,
  id: string,
  format: string,
  ctx?: QueryCtx,
): Promise<{ bytes: Buffer } | null> {
  if (!UUID_RE.test(id)) return null;
  if ((await getReportAccess(userId, id, ctx)) !== "full") {
    if (!(await readInvestigation(userId, id, ctx))) return null;
    throw new PreviewLockedError();
  }
  return readArtifact(userId, id, format, ctx);
}

/** Everything the CSV/JSON/Markdown/IOC exports need. Throws PreviewLockedError for a preview account. */
export async function loadSnapshot(
  userId: string,
  id: string,
  ctx?: QueryCtx,
): Promise<SnapshotForExport | null> {
  if (!UUID_RE.test(id)) return null;
  if ((await getReportAccess(userId, id, ctx)) !== "full") {
    if (!(await readInvestigation(userId, id, ctx))) return null;
    throw new PreviewLockedError();
  }
  return readSnapshot(userId, id, ctx);
}
