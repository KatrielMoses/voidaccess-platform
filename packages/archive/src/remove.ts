/**
 * The removal path (legal request, takedown, poisoning). Nothing in normal operation deletes archive data;
 * this does, deliberately: it tombstones the rows (hidden from every read, never resurrected by a later run),
 * deletes the snapshot object and all of its versions, remembers removed page hashes so the same content can't
 * come back, and writes an audit_log row. System-role only.
 */
import { arr } from "./sqlutil";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  archiveEntities,
  archiveRemovedPages,
  archiveSources,
  auditLog,
  getDatabase,
  type Database,
} from "@voidaccess/db";
import { canonicalUrl } from "./canonical";
import { recomputeEntities, recomputeRelationships } from "./archive";
import type { ArchiveObjectStore } from "./store";

export type RemovalKind = "entity" | "source" | "page";
export interface RemovalRequest {
  kind: RemovalKind;
  /** entity: a uuid or "TYPE:canonical value"; source: a uuid or its URL; page: the sha256 of its text (or its object key) */
  key: string;
  reason: string;
  /** who is doing this, e.g. "ops:alice" */
  actor: string;
}
export interface RemovalResult {
  tombstoned: number;
  objectsDeleted: number;
  recomputed: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export async function removeFromArchive(
  req: RemovalRequest,
  ctx: { objectStore: ArchiveObjectStore; database?: Database; now?: Date },
): Promise<RemovalResult> {
  if (!req.reason.trim() || !req.actor.trim()) throw new Error("removal needs a reason and an actor");
  const database = ctx.database ?? getDatabase();
  const now = ctx.now ?? new Date();
  const objects = new Set<string>();
  const out: RemovalResult = { tombstoned: 0, objectsDeleted: 0, recomputed: 0 };

  await database.withSystem("archive.remove", async (tx) => {
    if (req.kind === "entity") {
      let where;
      if (UUID.test(req.key)) where = eq(archiveEntities.id, req.key);
      else {
        const i = req.key.indexOf(":");
        if (i < 1) throw new Error('entity key must be a uuid or "TYPE:value"');
        const type = req.key.slice(0, i);
        const value = req.key.slice(i + 1);
        where = and(
          eq(archiveEntities.type, type),
          or(eq(archiveEntities.canonicalValue, value), eq(archiveEntities.fingerprint, value)),
        );
      }
      const rows = await tx
        .update(archiveEntities)
        .set({ tombstonedAt: now })
        .where(and(where, isNull(archiveEntities.tombstonedAt)))
        .returning({ id: archiveEntities.id });
      out.tombstoned = rows.length;
    } else {
      let hashes: string[] = [];
      let sourceIds: string[] = [];
      if (req.kind === "source") {
        const url = UUID.test(req.key) ? null : (canonicalUrl(req.key)?.key ?? req.key);
        const rows = await tx
          .update(archiveSources)
          .set({ tombstonedAt: now })
          .where(
            and(
              url === null ? eq(archiveSources.id, req.key) : eq(archiveSources.url, url),
              isNull(archiveSources.tombstonedAt),
            ),
          )
          .returning({ id: archiveSources.id, hash: archiveSources.contentHash });
        out.tombstoned = rows.length;
        sourceIds = rows.map((r) => r.id);
        hashes = rows.map((r) => r.hash).filter((h): h is string => Boolean(h));
      } else {
        const m = /^(?:pages\/)?([0-9a-f]{64})(?:\.txt\.gz)?$/.exec(req.key);
        if (!m || !HASH.test(m[1]!)) throw new Error("page key must be a sha256 hash or pages/<hash>.txt.gz");
        hashes = [m[1]!];
      }
      for (const h of hashes) {
        objects.add(`pages/${h}.txt.gz`);
        await tx.insert(archiveRemovedPages).values({ contentHash: h, removedAt: now }).onConflictDoNothing();
      }
      if (hashes.length) {
        const holders = await tx
          .update(archiveSources)
          .set({ contentHash: null, snapshotPath: null })
          .where(inArray(archiveSources.contentHash, hashes))
          .returning({ id: archiveSources.id });
        sourceIds.push(...holders.map((h) => h.id));
      }
      if (req.kind === "page") out.tombstoned = hashes.length;
      // counts that depended on a removed source change: recompute everything it touched
      if (sourceIds.length) {
        const ents = await tx.execute<{ id: string }>(
          sql`select distinct entity_id as id from archive_observations where source_id = any(${arr(sourceIds, "uuid")})`,
        );
        const rels = await tx.execute<{ id: string }>(
          sql`select distinct relationship_id as id from archive_relationship_sources where source_id = any(${arr(sourceIds, "uuid")})`,
        );
        await recomputeEntities(
          tx,
          ents.rows.map((r) => r.id),
        );
        await recomputeRelationships(
          tx,
          rels.rows.map((r) => r.id),
        );
        out.recomputed = ents.rows.length + rels.rows.length;
      }
    }
    await tx.insert(auditLog).values({
      actor: req.actor,
      action: "archive.remove",
      target: `${req.kind}:${req.key}`.slice(0, 300),
      meta: { kind: req.kind, reason: req.reason.slice(0, 1000), tombstoned: out.tombstoned },
    });
  });

  for (const key of objects) {
    await ctx.objectStore.deleteAll(key);
    out.objectsDeleted++;
  }
  return out;
}
