/**
 * Credit ledger operations. Every amount and price comes from @voidaccess/config.
 * Invariants are also enforced in Postgres (see migration 0001): append-only, unique idempotency keys,
 * grant bucket and every lot can never go negative, all serialised per user by an advisory lock.
 */
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import {
  DEPTHS,
  PLANS,
  TOPUPS,
  TOPUP_EXPIRY_MONTHS,
  depthCredits,
  topupCredits,
  type Depth,
  type PlanId,
} from "@voidaccess/config";
import type { Stage } from "@voidaccess/engine-client";
import { addMonths, inSystem, inUser, lockUserCredits, nowOf, type Ctx } from "./ctx";
import type { Tx } from "./client";
import { creditLedger, investigations, topupLots, users } from "./schema";
import { STAGE_WEIGHTS } from "./stage-weights";

export type ReserveResult =
  | { ok: true; charged: number; alreadyReserved: boolean }
  | {
      ok: false;
      reason: "insufficient_credits" | "depth_unavailable" | "plan_required";
      needed: number;
      balance: number;
    };

/** Spendable balance right now: grant bucket + unexpired lot remainders. */
async function spendable(tx: Tx, userId: string, now: Date) {
  const [g] = await tx
    .select({ bal: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.bucket, "grant")));
  const lots = await tx
    .select()
    .from(topupLots)
    .where(and(eq(topupLots.userId, userId), gt(topupLots.remaining, 0), gt(topupLots.expiresAt, now)))
    .orderBy(asc(topupLots.expiresAt), asc(topupLots.purchasedAt), asc(topupLots.id));
  const grant = g?.bal ?? 0;
  return { grant, lots, total: grant + lots.reduce((a, l) => a + l.remaining, 0) };
}

export async function getBalance(userId: string, ctx: Ctx = {}) {
  return inUser(ctx, userId, async (tx) => {
    const s = await spendable(tx, userId, nowOf(ctx));
    return { grant: s.grant, topup: s.lots.reduce((a, l) => a + l.remaining, 0), total: s.total };
  });
}

/**
 * Reserve the fixed price of `depth` for an investigation. Spends the grant bucket first, then top-up
 * lots by soonest expiry. Pass `ctx.tx` (a withUser tx) to reserve in the same transaction as the
 * investigation insert. The investigation row must already exist in that transaction.
 * Idempotent per investigation.
 */
export async function reserve(
  userId: string,
  investigationId: string,
  depth: Depth,
  ctx: Ctx = {},
): Promise<ReserveResult> {
  const now = nowOf(ctx);
  return inUser(ctx, userId, async (tx) => {
    const price = depthCredits(depth);
    await lockUserCredits(tx, userId);

    const prior = await tx
      .select({ amount: creditLedger.amount })
      .from(creditLedger)
      .where(and(eq(creditLedger.investigationId, investigationId), eq(creditLedger.reason, "reserve")));
    if (prior.length > 0) return { ok: true, charged: -prior.reduce((a, r) => a + r.amount, 0), alreadyReserved: true };

    const s = await spendable(tx, userId, now);
    if (!DEPTHS[depth].launched) return { ok: false, reason: "depth_unavailable", needed: price, balance: s.total };
    if (DEPTHS[depth].paidOnly) {
      const [u] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId));
      if (!u || PLANS[u.plan].monthlyUsd === 0) {
        return { ok: false, reason: "plan_required", needed: price, balance: s.total };
      }
    }
    if (s.total < price) return { ok: false, reason: "insufficient_credits", needed: price, balance: s.total };

    let need = price;
    const fromGrant = Math.min(s.grant, need);
    if (fromGrant > 0) {
      await tx.insert(creditLedger).values({
        userId,
        bucket: "grant",
        amount: -fromGrant,
        reason: "reserve",
        investigationId,
        idempotencyKey: `reserve:${investigationId}:grant`,
      });
      need -= fromGrant;
    }
    for (const lot of s.lots) {
      if (need === 0) break;
      const take = Math.min(lot.remaining, need);
      await tx.insert(creditLedger).values({
        userId,
        bucket: "topup",
        amount: -take,
        reason: "reserve",
        investigationId,
        lotId: lot.id,
        idempotencyKey: `reserve:${investigationId}:lot:${lot.id}`,
      });
      need -= take;
    }
    await tx.update(investigations).set({ creditsCharged: price }).where(eq(investigations.id, investigationId));
    return { ok: true, charged: price, alreadyReserved: false };
  });
}

/** Stage weights → fraction of cost consumed by the stages that ran. */
function consumedShare(stagesCompleted: readonly Stage[]): number {
  const total = Object.values(STAGE_WEIGHTS).reduce((a, b) => a + b, 0);
  const done = new Set(stagesCompleted).size
    ? [...new Set(stagesCompleted)].reduce((a, s) => a + (STAGE_WEIGHTS[s] ?? 0), 0)
    : 0;
  return done / total;
}

export interface RefundResult {
  refunded: number;
  charged: number;
  alreadyRefunded: boolean;
}

/**
 * Refund a reserved run, once per investigation. Full by default; pass `stagesCompleted` for a partial
 * refund of the stages that did not run. Credits return to the buckets they were taken from, most
 * recently spent first (top-up lots, then grant).
 */
export async function refund(
  userId: string,
  investigationId: string,
  opts: { stagesCompleted?: readonly Stage[] } = {},
  ctx: Ctx = {},
): Promise<RefundResult> {
  return inSystem(ctx, "ledger.refund", async (tx) => {
    await lockUserCredits(tx, userId);
    const rows = await tx
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.investigationId, investigationId), eq(creditLedger.userId, userId)));
    const reserves = rows.filter((r) => r.reason === "reserve");
    const charged = -reserves.reduce((a, r) => a + r.amount, 0);
    const prior = rows.filter((r) => r.reason === "refund");
    if (prior.length > 0 || charged === 0) {
      return { refunded: prior.reduce((a, r) => a + r.amount, 0), charged, alreadyRefunded: true };
    }
    const keep = opts.stagesCompleted ? Math.round(charged * consumedShare(opts.stagesCompleted)) : 0;
    let left = Math.max(0, Math.min(charged, charged - keep));
    const refunded = left;

    const lotReserves = reserves.filter((r) => r.lotId);
    const lotExpiry = new Map(
      (await tx.select().from(topupLots).where(eq(topupLots.userId, userId))).map((l) => [l.id, l.expiresAt.getTime()]),
    );
    lotReserves.sort((a, b) => (lotExpiry.get(b.lotId!) ?? 0) - (lotExpiry.get(a.lotId!) ?? 0));
    const order = [...lotReserves, ...reserves.filter((r) => !r.lotId)];
    for (const r of order) {
      if (left === 0) break;
      const give = Math.min(-r.amount, left);
      await tx.insert(creditLedger).values({
        userId,
        bucket: r.bucket,
        amount: give,
        reason: "refund",
        investigationId,
        lotId: r.lotId,
        idempotencyKey: `refund:${investigationId}:${r.lotId ?? "grant"}`,
      });
      left -= give;
    }
    await tx
      .update(investigations)
      .set({ creditsCharged: charged - refunded })
      .where(eq(investigations.id, investigationId));
    return { refunded, charged, alreadyRefunded: false };
  });
}

/**
 * Monthly subscription grant. Expires the previous grant remainder first, then grants the plan's
 * monthly credits (from config). Idempotent per (user, period).
 */
export async function grantMonthly(
  userId: string,
  plan: PlanId,
  periodStart: Date,
  ctx: Ctx = {},
): Promise<{ granted: boolean; expired: number; credits: number }> {
  const period = periodStart.toISOString().slice(0, 10);
  const credits = PLANS[plan].monthlyCredits;
  return inSystem(ctx, "ledger.grantMonthly", async (tx) => {
    await lockUserCredits(tx, userId);
    const key = `grant:${userId}:${period}`;
    const [dup] = await tx.select({ id: creditLedger.id }).from(creditLedger).where(eq(creditLedger.idempotencyKey, key));
    if (dup) return { granted: false, expired: 0, credits };
    const [g] = await tx
      .select({ bal: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, userId), eq(creditLedger.bucket, "grant")));
    const remainder = g?.bal ?? 0;
    if (remainder > 0) {
      await tx.insert(creditLedger).values({
        userId,
        bucket: "grant",
        amount: -remainder,
        reason: "expiry",
        idempotencyKey: `grant-expiry:${userId}:${period}`,
      });
    }
    await tx.insert(creditLedger).values({
      userId,
      bucket: "grant",
      amount: credits,
      reason: "grant",
      expiresAt: addMonths(periodStart, 1),
      idempotencyKey: key,
    });
    return { granted: true, expired: remainder, credits };
  });
}

/**
 * Top-up purchase. Credits come from config's topupCredits() (tier + subscriber bonus for the user's plan);
 * the base and the bonus are separate ledger rows on one lot. `paymentRef` (the provider payment id)
 * makes the call idempotent for webhook retries.
 */
export async function topup(
  userId: string,
  usd: number,
  paymentRef: string,
  ctx: Ctx = {},
): Promise<{ lotId: string; credits: number; duplicate: boolean }> {
  const now = nowOf(ctx);
  const tier = TOPUPS.find((t) => t.usd === usd);
  if (!tier) throw new Error(`No top-up tier for $${usd}`);
  return inSystem(ctx, "ledger.topup", async (tx) => {
    await lockUserCredits(tx, userId);
    const [dup] = await tx.select().from(topupLots).where(and(eq(topupLots.userId, userId), eq(topupLots.paymentRef, paymentRef)));
    if (dup) return { lotId: dup.id, credits: dup.creditsInitial, duplicate: true };
    const [u] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId));
    if (!u) throw new Error("topup: unknown user");
    const credits = topupCredits(usd, u.plan);
    const bonus = credits - tier.credits;
    const [lot] = await tx
      .insert(topupLots)
      .values({
        userId,
        creditsInitial: credits,
        remaining: 0, // raised to credits_initial by the ledger rows below
        usd,
        paymentRef,
        purchasedAt: now,
        expiresAt: addMonths(now, TOPUP_EXPIRY_MONTHS),
      })
      .returning();
    await tx.insert(creditLedger).values({
      userId,
      bucket: "topup",
      amount: tier.credits,
      reason: "topup",
      lotId: lot!.id,
      expiresAt: lot!.expiresAt,
      idempotencyKey: `topup:${paymentRef}`,
    });
    if (bonus > 0) {
      await tx.insert(creditLedger).values({
        userId,
        bucket: "topup",
        amount: bonus,
        reason: "bonus",
        lotId: lot!.id,
        expiresAt: lot!.expiresAt,
        idempotencyKey: `topup-bonus:${paymentRef}`,
      });
    }
    return { lotId: lot!.id, credits, duplicate: false };
  });
}

/** Admin credit grant as a top-up-style lot (default expiry like a top-up). `key` makes it idempotent. */
export async function adminGrant(
  userId: string,
  credits: number,
  actorId: string,
  key: string,
  opts: { expiresAt?: Date } = {},
  ctx: Ctx = {},
): Promise<{ lotId: string; duplicate: boolean }> {
  if (!Number.isInteger(credits) || credits <= 0) throw new Error("adminGrant: credits must be a positive integer");
  const now = nowOf(ctx);
  return inSystem(ctx, "ledger.adminGrant", async (tx) => {
    await lockUserCredits(tx, userId);
    const [dup] = await tx.select().from(creditLedger).where(eq(creditLedger.idempotencyKey, `admin:${key}`));
    if (dup) return { lotId: dup.lotId!, duplicate: true };
    const [lot] = await tx
      .insert(topupLots)
      .values({
        userId,
        creditsInitial: credits,
        remaining: 0,
        paymentRef: `admin:${key}`,
        purchasedAt: now,
        expiresAt: opts.expiresAt ?? addMonths(now, TOPUP_EXPIRY_MONTHS),
      })
      .returning();
    await tx.insert(creditLedger).values({
      userId,
      bucket: "topup",
      amount: credits,
      reason: "admin",
      lotId: lot!.id,
      expiresAt: lot!.expiresAt,
      actorId,
      idempotencyKey: `admin:${key}`,
    });
    return { lotId: lot!.id, duplicate: false };
  });
}

/** Expire every top-up lot past its expiry (cron). Returns lots expired and credits removed. */
export async function expireLots(now: Date, ctx: Ctx = {}): Promise<{ lots: number; credits: number }> {
  return inSystem(ctx, "ledger.expireLots", async (tx) => {
    const due = await tx
      .select()
      .from(topupLots)
      .where(and(sql`${topupLots.expiresAt} <= ${now.toISOString()}::timestamptz`, gt(topupLots.remaining, 0)))
      .orderBy(desc(topupLots.expiresAt));
    let credits = 0;
    let lots = 0;
    for (const lot of due) {
      await lockUserCredits(tx, lot.userId);
      const [fresh] = await tx.select().from(topupLots).where(eq(topupLots.id, lot.id));
      if (!fresh || fresh.remaining <= 0) continue;
      await tx.insert(creditLedger).values({
        userId: lot.userId,
        bucket: "topup",
        amount: -fresh.remaining,
        reason: "expiry",
        lotId: lot.id,
        idempotencyKey: `expiry:lot:${lot.id}`,
      });
      credits += fresh.remaining;
      lots++;
    }
    return { lots, credits };
  });
}
