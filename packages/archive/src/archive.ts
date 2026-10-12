/**
 * archiveRun: turn one finished run's findings into permanent, dated, ANONYMOUS archive rows.
 * Nothing written here carries the run id, the investigation, the user or the query: the function reads them
 * (the run id only to fetch the artifacts) and the data model has nowhere to put them.
 * Dates are the sources' own fetch times, never the time a user ran a search.
 */
import { arr } from "./sqlutil";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { inArray, sql } from "drizzle-orm";
import {
  archiveAliases,
  archiveEntities,
  archiveObservations,
  archiveRelationshipSources,
  archiveRelationships,
  archiveRemovedPages,
  archiveSources,
  getDatabase,
  type Database,
  type Tx,
} from "@voidaccess/db";
import { ResultBundle, checkBundleIntegrity } from "@voidaccess/engine-client";
import { transformBundle } from "@voidaccess/ingest";
import { aliasesOf } from "./aliases";
import { canonicalUrl, canonicalize } from "./canonical";
import { feedMatchFor } from "./feeds";
import { isClean } from "./scan";
import type { ArchiveDeps, ArchiveResult, PageRecord } from "./types";

export interface ArchiveOptions {
  database?: Database;
  fingerprintKey?: string;
}

const CHUNK = 500;
const chunks = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unnamed";
const MENTION_TYPES = new Set(["ONION_URL", "URL"]);
const SKIP_TYPES = new Set(["DATE"]);

interface SrcAgg {
  url: string;
  host: string;
  kind: string;
  firstSeen: Date;
  lastSeen: Date;
  lastAlive: Date | null;
  contentHash: string | null;
  snapshotPath: string | null;
  excerpt: string;
}

interface EntAgg {
  key: string;
  type: string;
  canonical: string | null;
  fingerprint: string | null;
  display: string;
  sensitive: boolean;
  feedMatch: string | null;
  names: Set<string>;
  observed: Map<string, Date>; // source url -> observed_at (the source's fetch time)
  firstSeen: Date;
}

const earlier = (a: Date, b: Date) => (a <= b ? a : b);
const later = (a: Date, b: Date) => (a >= b ? a : b);

export async function archiveRun(
  runId: string,
  deps: ArchiveDeps,
  opts: ArchiveOptions = {},
): Promise<ArchiveResult> {
  const database = opts.database ?? getDatabase();
  const fingerprintKey = opts.fingerprintKey ?? process.env.VA_FINGERPRINT_KEY;
  if (!fingerprintKey) throw new Error("VA_FINGERPRINT_KEY is not set");

  const bundle = ResultBundle.parse(await deps.readBundle(runId));
  const problems = checkBundleIntegrity(bundle);
  if (problems.length) throw new Error(`bundle integrity: ${problems[0]}`);
  const t = transformBundle(bundle, { fingerprintKey });
  const result: ArchiveResult = {
    entities: 0,
    sources: 0,
    observations: 0,
    relationships: 0,
    pagesStored: 0,
    pagesDeduplicated: 0,
    pagesDropped: { scan: 0, removed: 0, invalid: 0 },
    excerptsDropped: 0,
  };

  // ---- sources from the bundle (a source in a bundle was fetched, so it was alive at fetched_at) ----
  const sources = new Map<string, SrcAgg>();
  const srcByBundleId = new Map<string, string>();
  const fetchedAtByBundleId = new Map<string, Date>();
  for (const s of t.sources) {
    fetchedAtByBundleId.set(s.bundleId, s.fetchedAt);
    const c = canonicalUrl(s.url ?? `urn:${s.kind}:${slug(s.name)}`);
    if (!c) continue;
    srcByBundleId.set(s.bundleId, c.key);
    let excerpt = s.excerpt;
    if (excerpt && !isClean(excerpt)) {
      excerpt = "";
      result.excerptsDropped++;
    }
    const prev = sources.get(c.key);
    if (prev) {
      prev.firstSeen = earlier(prev.firstSeen, s.fetchedAt);
      prev.lastSeen = later(prev.lastSeen, s.fetchedAt);
      prev.lastAlive = later(prev.lastAlive ?? s.fetchedAt, s.fetchedAt);
      if (excerpt && s.fetchedAt >= (prev.lastAlive ?? s.fetchedAt)) prev.excerpt = excerpt;
    } else {
      sources.set(c.key, {
        url: c.key,
        host: c.host,
        kind: s.kind,
        firstSeen: s.fetchedAt,
        lastSeen: s.fetchedAt,
        lastAlive: s.fetchedAt,
        contentHash: null,
        snapshotPath: null,
        excerpt,
      });
    }
  }

  // ---- page snapshots: scan, content-address, store once ----
  if (deps.readPages) {
    const pages: { rec: PageRecord; url: string; host: string; at: Date; hash: string; gz: Buffer }[] = [];
    const iterable = deps.readPages(runId);
    if (iterable) {
      for await (const rec of iterable) {
        const c = canonicalUrl(rec.url ?? "");
        const at = new Date(rec.fetched_at);
        if (!c || typeof rec.text !== "string" || !rec.text.trim() || Number.isNaN(at.getTime())) {
          result.pagesDropped.invalid++;
          continue;
        }
        if (!isClean(rec.text)) {
          result.pagesDropped.scan++; // a page that still looks like it holds credentials or personal data is never kept
          continue;
        }
        const hash = createHash("sha256").update(rec.text).digest("hex");
        pages.push({
          rec,
          url: c.key,
          host: c.host,
          at,
          hash,
          gz: gzipSync(Buffer.from(rec.text, "utf8"), { level: 9 }),
        });
      }
    }
    const removed = pages.length
      ? new Set(
          (
            await database.withSystem(
              "archive.removed.lookup",
              (tx) =>
                tx
                  .select({ h: archiveRemovedPages.contentHash })
                  .from(archiveRemovedPages)
                  .where(
                    inArray(
                      archiveRemovedPages.contentHash,
                      pages.map((p) => p.hash),
                    ),
                  ),
              { audit: false },
            )
          ).map((r) => r.h),
        )
      : new Set<string>();
    for (const p of pages) {
      if (removed.has(p.hash)) {
        result.pagesDropped.removed++;
        continue;
      }
      const key = `pages/${p.hash}.txt.gz`;
      if ((await deps.objectStore.put(key, p.gz)) === "created") result.pagesStored++;
      else result.pagesDeduplicated++;
      const prev = sources.get(p.url);
      if (prev) {
        prev.firstSeen = earlier(prev.firstSeen, p.at);
        prev.lastSeen = later(prev.lastSeen, p.at);
        if (!prev.lastAlive || p.at >= prev.lastAlive) {
          prev.lastAlive = p.at;
          prev.contentHash = p.hash;
          prev.snapshotPath = key;
        }
      } else {
        sources.set(p.url, {
          url: p.url,
          host: p.host,
          kind: "page",
          firstSeen: p.at,
          lastSeen: p.at,
          lastAlive: p.at,
          contentHash: p.hash,
          snapshotPath: key,
          excerpt: "",
        });
      }
    }
  }

  // ---- entities, canonicalised ----
  const ents = new Map<string, EntAgg>();
  const entKeyByBundleId = new Map<string, string>();
  for (const e of t.entities) {
    if (SKIP_TYPES.has(e.type)) continue;
    let type = e.type;
    let canonical: string | null = null;
    let display = e.displayValue;
    if (!e.sensitive) {
      const c = e.value ? canonicalize(e.type, e.value) : null;
      if (!c || !c.canonical) continue;
      type = c.type;
      canonical = c.canonical;
      display = c.display;
    } else if (!e.fingerprint) continue;
    const key = e.sensitive ? `${type}\u0000fp:${e.fingerprint}` : `${type}\u0000${canonical}`;
    entKeyByBundleId.set(e.bundleId, key);
    let agg = ents.get(key);
    if (!agg) {
      agg = {
        key,
        type,
        canonical,
        fingerprint: e.sensitive ? e.fingerprint : null,
        display,
        sensitive: e.sensitive,
        feedMatch: feedMatchFor(type, canonical),
        names: new Set(),
        observed: new Map(),
        firstSeen: e.firstSeen ?? new Date(8.64e15),
      };
      ents.set(key, agg);
    }
    if (
      !e.sensitive &&
      e.value &&
      ["RANSOMWARE_GROUP", "THREAT_ACTOR", "THREAT_ACTOR_HANDLE", "MALWARE_FAMILY"].includes(e.type)
    )
      agg.names.add(e.value.trim());
    if (e.firstSeen) agg.firstSeen = earlier(agg.firstSeen, e.firstSeen);
    for (const sid of e.sourceIds) {
      const skey = srcByBundleId.get(sid);
      const src = skey ? sources.get(skey) : undefined;
      if (!skey || !src) continue;
      const own = fetchedAtByBundleId.get(sid) ?? src.firstSeen;
      const prev = agg.observed.get(skey);
      agg.observed.set(skey, prev ? earlier(prev, own) : own);
    }
  }
  // an entity with no dated source and no detection time carries no date: it can't be archived honestly
  for (const [k, a] of ents) {
    if (a.observed.size === 0 && a.firstSeen.getTime() > 8e15) ents.delete(k);
    else if (a.observed.size > 0) a.firstSeen = [...a.observed.values()].reduce(earlier);
  }

  // ---- relationships (bundle ids -> entity keys), evidence = source pages ----
  interface RelAgg {
    a: string;
    b: string;
    type: string;
    evidence: Set<string>;
  }
  const rels = new Map<string, RelAgg>();
  for (const r of t.relationships) {
    const ka = entKeyByBundleId.get(r.sourceBundleId);
    const kb = entKeyByBundleId.get(r.targetBundleId);
    if (!ka || !kb || ka === kb || !ents.has(ka) || !ents.has(kb)) continue;
    let ev = r.evidenceSourceIds.map((s) => srcByBundleId.get(s)).filter((s): s is string => Boolean(s));
    if (ev.length === 0) {
      const common = [...ents.get(ka)!.observed.keys()].filter((s) => ents.get(kb)!.observed.has(s));
      ev = common;
    }
    if (ev.length === 0) continue;
    const symmetric = r.type === "CO_APPEARED_ON";
    const [a, b] = symmetric && ka > kb ? [kb, ka] : [ka, kb];
    const rk = `${a}\u0001${b}\u0001${r.type}`;
    const agg = rels.get(rk) ?? { a, b, type: r.type, evidence: new Set<string>() };
    for (const e of ev) agg.evidence.add(e);
    rels.set(rk, agg);
  }

  const mentions: { url: string; at: Date }[] = [];
  for (const a of ents.values())
    if (MENTION_TYPES.has(a.type) && a.canonical && !sources.has(a.canonical) && a.observed.size > 0)
      mentions.push({ url: a.canonical, at: [...a.observed.values()].reduce(later) });

  // ---- one transaction: everything or nothing ----
  await database.withSystem("archive.ingest", async (tx) => {
    const srcId = await upsertSources(tx, [...sources.values()]);
    const entIds = await upsertEntities(tx, [...ents.values()]);
    result.sources = srcId.size;
    result.entities = entIds.size;

    const obs: { entityId: string; sourceId: string; observedAt: Date }[] = [];
    for (const a of ents.values()) {
      const eid = entIds.get(a.key);
      if (!eid) continue;
      for (const [skey, at] of a.observed) {
        const sid = srcId.get(skey);
        if (sid) obs.push({ entityId: eid, sourceId: sid, observedAt: at });
      }
    }
    for (const c of chunks(obs)) await tx.insert(archiveObservations).values(c).onConflictDoNothing();
    result.observations = obs.length;

    // a mention of a known URL (without fetching it) proves it was still referenced then, not that it was alive
    for (const m of mentions)
      await tx.execute(
        sql`update archive_sources set last_seen = greatest(last_seen, ${m.at.toISOString()}::timestamptz) where url = ${m.url}`,
      );

    const aliasRows: { entityId: string; alias: string; firstSeen: Date }[] = [];
    for (const a of ents.values()) {
      const eid = entIds.get(a.key);
      if (!eid || a.sensitive) continue;
      for (const n of a.names)
        if (n !== a.display) aliasRows.push({ entityId: eid, alias: n, firstSeen: a.firstSeen });
      if (a.canonical)
        for (const n of aliasesOf(a.canonical))
          aliasRows.push({ entityId: eid, alias: n, firstSeen: a.firstSeen });
    }
    const aliasDedupe = new Map(aliasRows.map((r) => [`${r.entityId}\u0000${r.alias}`, r]));
    for (const c of chunks([...aliasDedupe.values()]))
      await tx
        .insert(archiveAliases)
        .values(c.map((r) => ({ ...r, kind: "alias" })))
        .onConflictDoNothing();

    await recomputeEntities(tx, [...entIds.values()]);

    // relationships
    const relRows: { a: string; b: string; type: string; ev: string[]; first: Date; last: Date }[] = [];
    for (const r of rels.values()) {
      let ea = entIds.get(r.a);
      let eb = entIds.get(r.b);
      if (!ea || !eb) continue;
      const evSources = [...r.evidence].map((s) => srcId.get(s)).filter((s): s is string => Boolean(s));
      if (evSources.length === 0) continue;
      if (r.type === "CO_APPEARED_ON" && ea > eb) [ea, eb] = [eb, ea];
      const times = [...r.evidence].map((s) => sources.get(s)!.lastAlive ?? sources.get(s)!.firstSeen);
      relRows.push({
        a: ea,
        b: eb,
        type: r.type,
        ev: evSources,
        first: times.reduce(earlier),
        last: times.reduce(later),
      });
    }
    const dedupe = new Map<string, (typeof relRows)[number]>();
    for (const r of relRows) {
      const k = `${r.a}|${r.b}|${r.type}`;
      const prev = dedupe.get(k);
      dedupe.set(
        k,
        prev
          ? {
              ...prev,
              ev: [...new Set([...prev.ev, ...r.ev])],
              first: earlier(prev.first, r.first),
              last: later(prev.last, r.last),
            }
          : r,
      );
    }
    const relIds: string[] = [];
    for (const c of chunks([...dedupe.values()])) {
      const ret = await tx
        .insert(archiveRelationships)
        .values(
          c.map((r) => ({
            aEntityId: r.a,
            bEntityId: r.b,
            type: r.type,
            firstSeen: r.first,
            lastSeen: r.last,
          })),
        )
        .onConflictDoUpdate({
          target: [archiveRelationships.aEntityId, archiveRelationships.bEntityId, archiveRelationships.type],
          set: {
            firstSeen: sql`least(${archiveRelationships.firstSeen}, excluded.first_seen)`,
            lastSeen: sql`greatest(${archiveRelationships.lastSeen}, excluded.last_seen)`,
          },
        })
        .returning({
          id: archiveRelationships.id,
          a: archiveRelationships.aEntityId,
          b: archiveRelationships.bEntityId,
          type: archiveRelationships.type,
        });
      const idOf = new Map(ret.map((x) => [`${x.a}|${x.b}|${x.type}`, x.id]));
      const links: { relationshipId: string; sourceId: string }[] = [];
      for (const r of c) {
        const id = idOf.get(`${r.a}|${r.b}|${r.type}`)!;
        relIds.push(id);
        for (const s of r.ev) links.push({ relationshipId: id, sourceId: s });
      }
      for (const l of chunks(links, 2000))
        await tx.insert(archiveRelationshipSources).values(l).onConflictDoNothing();
    }
    result.relationships = relIds.length;
    await recomputeRelationships(tx, relIds);
  });
  return result;
}

async function upsertSources(tx: Tx, rows: SrcAgg[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const newer = sql.raw(
    `excluded.last_alive IS NOT NULL AND (archive_sources.last_alive IS NULL OR excluded.last_alive >= archive_sources.last_alive)`,
  );
  for (const c of chunks(rows)) {
    const ret = await tx
      .insert(archiveSources)
      .values(
        c.map((r) => ({
          url: r.url,
          host: r.host,
          kind: r.kind,
          firstSeen: r.firstSeen,
          lastSeen: r.lastSeen,
          lastAlive: r.lastAlive,
          contentHash: r.contentHash,
          snapshotPath: r.snapshotPath,
          excerpt: r.excerpt,
        })),
      )
      .onConflictDoUpdate({
        target: archiveSources.url,
        set: {
          firstSeen: sql`least(${archiveSources.firstSeen}, excluded.first_seen)`,
          lastSeen: sql`greatest(${archiveSources.lastSeen}, excluded.last_seen)`,
          lastAlive: sql`greatest(${archiveSources.lastAlive}, excluded.last_alive)`,
          contentHash: sql`case when ${newer} and excluded.content_hash is not null then excluded.content_hash else ${archiveSources.contentHash} end`,
          snapshotPath: sql`case when ${newer} and excluded.snapshot_path is not null then excluded.snapshot_path else ${archiveSources.snapshotPath} end`,
          excerpt: sql`case when ${newer} and excluded.excerpt <> '' then excluded.excerpt else ${archiveSources.excerpt} end`,
        },
      })
      .returning({
        id: archiveSources.id,
        url: archiveSources.url,
        tombstonedAt: archiveSources.tombstonedAt,
      });
    for (const r of ret) if (!r.tombstonedAt) out.set(r.url, r.id); // a removed source is never resurrected
  }
  return out;
}

async function upsertEntities(tx: Tx, rows: EntAgg[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pub = rows.filter((r) => !r.sensitive);
  const sens = rows.filter((r) => r.sensitive);
  const common = {
    firstSeen: sql`least(${archiveEntities.firstSeen}, excluded.first_seen)`,
    lastSeen: sql`greatest(${archiveEntities.lastSeen}, excluded.last_seen)`,
    feedMatch: sql`coalesce(${archiveEntities.feedMatch}, excluded.feed_match)`,
  };
  const values = (r: EntAgg) => {
    const last = r.observed.size ? [...r.observed.values()].reduce(later) : r.firstSeen;
    return {
      type: r.type,
      canonicalValue: r.canonical,
      fingerprint: r.fingerprint,
      displayValue: r.display,
      sensitive: r.sensitive,
      feedMatch: r.feedMatch,
      firstSeen: r.firstSeen,
      lastSeen: last,
    };
  };
  for (const c of chunks(pub)) {
    const ret = await tx
      .insert(archiveEntities)
      .values(c.map(values))
      .onConflictDoUpdate({ target: [archiveEntities.type, archiveEntities.canonicalValue], set: common })
      .returning({
        id: archiveEntities.id,
        type: archiveEntities.type,
        v: archiveEntities.canonicalValue,
        t: archiveEntities.tombstonedAt,
      });
    for (const r of ret) if (!r.t) out.set(`${r.type}\u0000${r.v}`, r.id);
  }
  for (const c of chunks(sens)) {
    const ret = await tx
      .insert(archiveEntities)
      .values(c.map(values))
      .onConflictDoUpdate({ target: [archiveEntities.type, archiveEntities.fingerprint], set: common })
      .returning({
        id: archiveEntities.id,
        type: archiveEntities.type,
        f: archiveEntities.fingerprint,
        t: archiveEntities.tombstonedAt,
      });
    for (const r of ret) if (!r.t) out.set(`${r.type}\u0000fp:${r.f}`, r.id);
  }
  return out;
}

/** Observation count, independent source count (distinct hosts), first/last seen and tier, from the observations themselves. */
export async function recomputeEntities(tx: Tx, ids: string[]): Promise<void> {
  for (const c of chunks(ids, 2000)) {
    await tx.execute(sql`
      update archive_entities e set
        observation_count = s.n, independent_source_count = s.h,
        first_seen = least(e.first_seen, s.mn), last_seen = greatest(e.last_seen, s.mx),
        tier = case when e.feed_match is not null then 'feed_validated'::archive_tier when s.h >= 2 then 'corroborated'::archive_tier else 'unconfirmed'::archive_tier end
      from (
        select o.entity_id, count(*)::int n, count(distinct src.host)::int h, min(o.observed_at) mn, max(o.observed_at) mx
        from archive_observations o join archive_sources src on src.id = o.source_id and src.tombstoned_at is null
        where o.entity_id = any(${arr(c, "uuid")}) group by o.entity_id) s
      where e.id = s.entity_id`);
  }
}

export async function recomputeRelationships(tx: Tx, ids: string[]): Promise<void> {
  for (const c of chunks(ids, 2000)) {
    await tx.execute(sql`
      update archive_relationships r set
        evidence_count = s.n, independent_source_count = s.h,
        tier = case when s.h >= 2 then 'corroborated'::archive_tier else 'unconfirmed'::archive_tier end
      from (
        select rs.relationship_id, count(*)::int n, count(distinct src.host)::int h
        from archive_relationship_sources rs join archive_sources src on src.id = rs.source_id and src.tombstoned_at is null
        where rs.relationship_id = any(${arr(c, "uuid")}) group by rs.relationship_id) s
      where r.id = s.relationship_id`);
  }
}
