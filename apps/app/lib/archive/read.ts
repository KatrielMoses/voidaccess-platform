/**
 * Archive context for a viewer's investigation. The investigation and its entities are read through withUser (RLS: another
 * user's id finds nothing); the archive itself is read with the app role's SELECT-only grant on the archive_* tables.
 * Only the viewer's own entity values and source URLs ever leave the tenant tables, and only to be matched against archive facts.
 * Preview lock (lib/access): for a preview account the overlay keeps its counts only (no entity, neighbour or source).
 */
import { eq } from "drizzle-orm";
import {
  archiveContext,
  archiveGraph,
  type ArchiveContext,
  type ArchiveGraph,
  type Probe,
  type Tier,
} from "@voidaccess/archive";
import { getDatabase, invEntities, invSources, investigations, type Database } from "@voidaccess/db";
import { UUID_RE } from "@/lib/results/queries";
import { accessMarker, redactArchiveContext, redactArchiveGraph, type AccessMarker } from "@/lib/access";

export async function loadProbe(
  userId: string,
  invId: string,
  database: Database = getDatabase(),
): Promise<Probe | null> {
  if (!UUID_RE.test(invId)) return null;
  return database.withUser(userId, async (tx) => {
    const [inv] = await tx
      .select({ id: investigations.id })
      .from(investigations)
      .where(eq(investigations.id, invId))
      .limit(1);
    if (!inv) return null;
    const [ents, srcs] = await Promise.all([
      tx
        .select({
          bundleId: invEntities.bundleId,
          type: invEntities.type,
          value: invEntities.value,
          fingerprint: invEntities.fingerprint,
        })
        .from(invEntities)
        .where(eq(invEntities.investigationId, invId)),
      tx
        .select({ url: invSources.url, kind: invSources.kind, name: invSources.name })
        .from(invSources)
        .where(eq(invSources.investigationId, invId)),
    ]);
    return {
      entities: ents.map((e) => ({
        key: e.bundleId,
        type: e.type,
        value: e.value,
        fingerprint: e.fingerprint,
      })),
      ownSources: srcs,
    };
  });
}

async function readArchiveContext(
  userId: string,
  invId: string,
  opts: { only?: string; lite?: boolean; database?: Database } = {},
): Promise<ArchiveContext | null> {
  const probe = await loadProbe(userId, invId, opts.database);
  if (!probe) return null;
  return archiveContext(probe, { database: opts.database, only: opts.only, lite: opts.lite });
}

/** The archive overlay with its `access` marker; a preview account gets the counts only. */
export async function getArchiveContext(
  userId: string,
  invId: string,
  opts: { only?: string; lite?: boolean; database?: Database } = {},
): Promise<(ArchiveContext & { access: AccessMarker }) | null> {
  const access = await accessMarker(userId, invId, { database: opts.database });
  const full = access.level === "full";
  // a preview needs the totals only: the lite read (no neighbours or offline sources) over every entity
  const ctx = await readArchiveContext(userId, invId, full ? opts : { lite: true, database: opts.database });
  if (!ctx) return null;
  return access.level === "full" ? { ...ctx, access } : redactArchiveContext(ctx, access.totals);
}

/** Archive neighbours as a graph; a preview account gets an empty graph with its `access` marker. */
export async function getArchiveGraph(
  userId: string,
  invId: string,
  opts: { hops?: 1 | 2; minTier?: Tier; database?: Database } = {},
): Promise<(ArchiveGraph & { access: AccessMarker }) | null> {
  const probe = await loadProbe(userId, invId, opts.database);
  if (!probe) return null;
  const access = await accessMarker(userId, invId, { database: opts.database });
  if (access.level !== "full")
    return redactArchiveGraph({ nodes: [], edges: [], truncated: false }, access.totals);
  const g = await archiveGraph(probe, { database: opts.database, hops: opts.hops, minTier: opts.minTier });
  return { ...g, access };
}

/** Bundle ids of this investigation's entities the archive has seen from elsewhere (for the "only new" filter). */
export async function seenBundleIds(
  userId: string,
  invId: string,
  database?: Database,
): Promise<Set<string> | null> {
  const ctx = await readArchiveContext(userId, invId, { lite: true, database });
  return ctx ? new Set(Object.keys(ctx.seen)) : null;
}
