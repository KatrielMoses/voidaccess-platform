/**
 * Archive context for a viewer's investigation. The investigation and its entities are read through withUser (RLS: another
 * user's id finds nothing); the archive itself is read with the app role's SELECT-only grant on the archive_* tables.
 * Only the viewer's own entity values and source URLs ever leave the tenant tables, and only to be matched against archive facts.
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

export async function getArchiveContext(
  userId: string,
  invId: string,
  opts: { only?: string; lite?: boolean; database?: Database } = {},
): Promise<ArchiveContext | null> {
  const probe = await loadProbe(userId, invId, opts.database);
  if (!probe) return null;
  return archiveContext(probe, { database: opts.database, only: opts.only, lite: opts.lite });
}

export async function getArchiveGraph(
  userId: string,
  invId: string,
  opts: { hops?: 1 | 2; minTier?: Tier; database?: Database } = {},
): Promise<ArchiveGraph | null> {
  const probe = await loadProbe(userId, invId, opts.database);
  if (!probe) return null;
  return archiveGraph(probe, { database: opts.database, hops: opts.hops, minTier: opts.minTier });
}

/** Bundle ids of this investigation's entities the archive has seen from elsewhere (for the "only new" filter). */
export async function seenBundleIds(
  userId: string,
  invId: string,
  database?: Database,
): Promise<Set<string> | null> {
  const ctx = await getArchiveContext(userId, invId, { lite: true, database });
  return ctx ? new Set(Object.keys(ctx.seen)) : null;
}
