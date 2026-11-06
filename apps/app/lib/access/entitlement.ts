/**
 * Who sees the full report. Computed at read time and never stored, so an upgrade unlocks every past report at once.
 *
 *  - "full" when the user's current plan is pro or pro_plus. users.plan is the billing source of truth: the Creem
 *    webhook and the crypto-pass IPN set it while a subscription is active, past due (grace) or paused, and the billing
 *    cron moves it back to free when a subscription ends (cancel at period end included). This is the same lookup as
 *    getPlanId in lib/results/queries.ts.
 *  - "full" when the run was paid wholly or partly from PURCHASED top-up credits: a `reserve` ledger row of this run
 *    drawn from a top-up lot that has a dollar amount (admin grants have none and do not count).
 *  - otherwise "preview".
 *
 * Reads run under withUser (RLS): another user's run has no visible ledger rows, and callers check that the run exists
 * before they use the answer, so this never tells anyone whether someone else's run exists.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { ENTITY_TYPES, entityCategory, type EntityType } from "@voidaccess/engine-client";
import {
  creditLedger,
  getDatabase,
  invActors,
  invEntities,
  invRelationships,
  invSources,
  topupLots,
  users,
  type Database,
} from "@voidaccess/db";
import { FULL_ACCESS, type AccessMarker, type ReportAccess, type PreviewTotals } from "./shared";

export interface AccessCtx {
  database?: Database;
}
const dbOf = (c?: AccessCtx) => c?.database ?? getDatabase();

export const FULL_PLANS: readonly string[] = ["pro", "pro_plus"];

export async function getReportAccess(userId: string, runId: string, ctx?: AccessCtx): Promise<ReportAccess> {
  return dbOf(ctx).withUser(userId, async (tx) => {
    const [u] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
    if (u && FULL_PLANS.includes(u.plan)) return "full";
    const [paid] = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .innerJoin(topupLots, eq(topupLots.id, creditLedger.lotId))
      .where(
        and(
          eq(creditLedger.investigationId, runId),
          eq(creditLedger.reason, "reserve"),
          eq(creditLedger.bucket, "topup"),
          isNotNull(topupLots.usd),
          sql`${topupLots.usd} > 0`,
        ),
      )
      .limit(1);
    return paid ? "full" : "preview";
  });
}

/** Indicator-like categories (the IOC export's set). */
const IOC_CATEGORIES = new Set([
  "network",
  "crypto",
  "malware",
  "vulnerability",
  "messaging",
  "identity",
  "credential",
]);
export function isIocType(type: string): boolean {
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) return false;
  return IOC_CATEGORIES.has(entityCategory(type as EntityType));
}

/** Full counts of a run's findings, read live from the snapshot tables. */
export async function previewTotals(userId: string, runId: string, ctx?: AccessCtx): Promise<PreviewTotals> {
  return dbOf(ctx).withUser(userId, async (tx) => {
    const n = sql<number>`count(*)::int`;
    const [types, [src], [act], [rel]] = await Promise.all([
      tx
        .select({ type: invEntities.type, n })
        .from(invEntities)
        .where(eq(invEntities.investigationId, runId))
        .groupBy(invEntities.type),
      tx.select({ n }).from(invSources).where(eq(invSources.investigationId, runId)),
      tx.select({ n }).from(invActors).where(eq(invActors.investigationId, runId)),
      tx.select({ n }).from(invRelationships).where(eq(invRelationships.investigationId, runId)),
    ]);
    const byType: Record<string, number> = {};
    for (const t of types) byType[t.type] = t.n;
    const entities = types.reduce((a, t) => a + t.n, 0);
    return {
      sources: src?.n ?? 0,
      entities,
      byType,
      actors: act?.n ?? 0,
      onions: byType.ONION_URL ?? 0,
      iocs: types.filter((t) => isIocType(t.type)).reduce((a, t) => a + t.n, 0),
      relationships: rel?.n ?? 0,
    };
  });
}

/** The access marker for a payload: `{level:"full"}`, or `{level:"preview", totals}` with the real counts. */
export async function accessMarker(userId: string, runId: string, ctx?: AccessCtx): Promise<AccessMarker> {
  const level = await getReportAccess(userId, runId, ctx);
  return level === "full"
    ? FULL_ACCESS
    : { level: "preview", totals: await previewTotals(userId, runId, ctx) };
}

/** Thrown by data functions whose whole payload is locked for a preview (exports, entity detail). Routes answer 402. */
export class PreviewLockedError extends Error {
  readonly code = "preview_locked";
  constructor() {
    super("This is a preview report. Upgrade to unlock the full report.");
    this.name = "PreviewLockedError";
  }
}
