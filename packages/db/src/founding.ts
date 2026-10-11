/**
 * Founding seats (PRD amendment 1). 100 seat rows exist from the migration; a seat is held while
 * holder_user_id IS NOT NULL. Capacity is a DB guarantee: claims are one UPDATE ... FOR UPDATE SKIP LOCKED.
 * Thresholds come from FOUNDING in @voidaccess/config.
 */
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { FOUNDING, type PlanId } from "@voidaccess/config";
import { addDays, addMonths, inSystem, nowOf, type Ctx } from "./ctx";
import type { Tx } from "./client";
import { getDatabase } from "./client";
import { auditLog, foundingNotices, foundingSeats, investigations, subscriptions } from "./schema";

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

export async function claimFoundingSeat(userId: string, ctx: Ctx = {}): Promise<number | null> {
  const now = nowOf(ctx);
  return inSystem(ctx, "founding.claim", async (tx) => {
    const [mine] = await tx.select().from(foundingSeats).where(eq(foundingSeats.holderUserId, userId));
    if (mine) return mine.seatNo;
    const res = await tx.execute<{ seat_no: number }>(sql`
      UPDATE founding_seats SET
        holder_user_id = ${userId}, last_holder_user_id = ${userId},
        claimed_at = ${ts(now)}, term_start = ${ts(now)},
        anniversary_at = ${ts(addMonths(now, FOUNDING.termMonths))},
        released_at = NULL, release_reason = NULL
      WHERE seat_no = (
        SELECT seat_no FROM founding_seats WHERE holder_user_id IS NULL
        ORDER BY seat_no LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING seat_no`);
    const seat = res.rows[0]?.seat_no ?? null;
    if (seat !== null) {
      await tx.insert(auditLog).values({ actor: "system", action: "founding.claim", target: userId, meta: { seat } });
    }
    return seat;
  });
}

/** Seats currently available (including reopened ones), for the pricing counter. */
export async function availableSeats(ctx: Ctx = {}): Promise<number> {
  const exec = ctx.tx ?? (ctx.database ?? getDatabase()).db;
  const res = await exec.execute<{ n: number }>(sql`select founding_seats_available() as n`);
  return Number(res.rows[0]?.n ?? 0);
}

export type FoundingAction =
  | { action: "renewed"; userId: string; seatNo: number; nextAnniversary: Date }
  | { action: "released"; userId: string; seatNo: number; reason: "renewal_failed" | "inactivity"; targetPlan: PlanId; effectiveAt: Date }
  | { action: "notice_scheduled"; userId: string; seatNo: number; kind: "renewal_check_30d" | "inactivity_30d"; scheduledFor: Date };

/** Distinct calendar months (UTC) covered by subscription payments in [from, to). */
export async function paidMonthsInWindow(tx: Tx, userId: string, from: Date, to: Date): Promise<number> {
  const res = await tx.execute<{ n: number }>(sql`
    SELECT count(DISTINCT date_trunc('month', coalesce(period_start, paid_at) AT TIME ZONE 'UTC'))::int AS n
    FROM payments
    WHERE user_id = ${userId} AND kind = 'subscription'
      AND coalesce(period_start, paid_at) >= ${ts(from)} AND coalesce(period_start, paid_at) < ${ts(to)}`);
  return Number(res.rows[0]?.n ?? 0);
}

async function activeProSubscription(tx: Tx, userId: string) {
  const [s] = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ["active", "past_due"])))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return s && s.plan === "pro" ? s : null;
}

async function release(
  tx: Tx,
  seatNo: number,
  userId: string,
  reason: "renewal_failed" | "inactivity" | "upgraded" | "admin" | "account_closed",
  now: Date,
) {
  await tx
    .update(foundingSeats)
    .set({ holderUserId: null, releasedAt: now, releaseReason: reason, termStart: null, anniversaryAt: null })
    .where(and(eq(foundingSeats.seatNo, seatNo), eq(foundingSeats.holderUserId, userId)));
  await tx.insert(auditLog).values({ actor: "system", action: "founding.release", target: userId, meta: { seatNo, reason } });
  // (b): a paying founder moves to Pro at the next renewal, never mid-period; otherwise Free now.
  const sub = await activeProSubscription(tx, userId);
  const targetPlan: PlanId = sub ? "pro" : "free";
  const effectiveAt = sub?.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
  await tx
    .insert(foundingNotices)
    .values({
      userId,
      seatNo,
      kind: "release_day",
      refAt: now,
      scheduledFor: now,
      payload: { reason, targetPlan, effectiveAt: effectiveAt.toISOString() },
    })
    .onConflictDoNothing();
  return { targetPlan, effectiveAt };
}

/** Release a seat explicitly (e.g. upgrade to Pro+ — interpretation (d)). */
export async function releaseFoundingSeat(userId: string, reason: "upgraded" | "admin" | "account_closed", ctx: Ctx = {}) {
  const now = nowOf(ctx);
  return inSystem(ctx, "founding.release", async (tx) => {
    const [seat] = await tx.select().from(foundingSeats).where(eq(foundingSeats.holderUserId, userId));
    if (!seat) return null;
    return { seatNo: seat.seatNo, ...(await release(tx, seat.seatNo, userId, reason, now)) };
  });
}

async function scheduleNotice(
  tx: Tx,
  userId: string,
  seatNo: number,
  kind: "renewal_check_30d" | "inactivity_30d",
  refAt: Date,
  payload: Record<string, unknown>,
): Promise<Date | null> {
  const scheduledFor = addDays(refAt, -FOUNDING.noticeDaysBeforeRelease);
  const ins = await tx
    .insert(foundingNotices)
    .values({ userId, seatNo, kind, refAt, scheduledFor, payload })
    .onConflictDoNothing()
    .returning({ id: foundingNotices.id });
  return ins.length > 0 ? scheduledFor : null;
}

/**
 * Daily job. For each held seat: (1) 10-month inactivity release, (2) anniversary renewal by the
 * ≥ 3-paid-months-of-trailing-12 rule, (3) 30-day notices. Idempotent (notices dedupe on user+kind+date).
 * Returns what happened, including the target plan for released users so billing can apply it.
 */
export async function runFoundingChecks(now: Date, ctx: Ctx = {}): Promise<FoundingAction[]> {
  return inSystem(ctx, "founding.runChecks", async (tx) => {
    const out: FoundingAction[] = [];
    const seats = await tx.select().from(foundingSeats).where(isNotNull(foundingSeats.holderUserId)).orderBy(foundingSeats.seatNo);
    for (const seat of seats) {
      const userId = seat.holderUserId!;
      const [last] = await tx
        .select({ at: sql<Date | null>`max(${investigations.createdAt})` })
        .from(investigations)
        .where(eq(investigations.userId, userId));
      const lastInvestigation = last?.at ? new Date(last.at) : null;
      const activityFrom =
        lastInvestigation && seat.claimedAt && lastInvestigation > seat.claimedAt ? lastInvestigation : (seat.claimedAt ?? now);
      const inactivityReleaseAt = addMonths(activityFrom, FOUNDING.inactivityReleaseMonths);

      if (now >= inactivityReleaseAt) {
        const r = await release(tx, seat.seatNo, userId, "inactivity", now);
        out.push({ action: "released", userId, seatNo: seat.seatNo, reason: "inactivity", ...r });
        continue;
      }
      if (now >= addDays(inactivityReleaseAt, -FOUNDING.noticeDaysBeforeRelease)) {
        const when = await scheduleNotice(tx, userId, seat.seatNo, "inactivity_30d", inactivityReleaseAt, {
          releaseAt: inactivityReleaseAt.toISOString(),
        });
        if (when) out.push({ action: "notice_scheduled", userId, seatNo: seat.seatNo, kind: "inactivity_30d", scheduledFor: when });
      }

      let anniversary = seat.anniversaryAt;
      if (!anniversary) continue;
      let released = false;
      while (anniversary && now >= anniversary) {
        const paid = await paidMonthsInWindow(tx, userId, addMonths(anniversary, -FOUNDING.termMonths), anniversary);
        if (paid >= FOUNDING.renewalMinPaidMonthsInTrailing12) {
          const next = addMonths(anniversary, FOUNDING.termMonths);
          await tx.update(foundingSeats).set({ termStart: anniversary, anniversaryAt: next }).where(eq(foundingSeats.seatNo, seat.seatNo));
          out.push({ action: "renewed", userId, seatNo: seat.seatNo, nextAnniversary: next });
          anniversary = next;
        } else {
          const r = await release(tx, seat.seatNo, userId, "renewal_failed", now);
          out.push({ action: "released", userId, seatNo: seat.seatNo, reason: "renewal_failed", ...r });
          released = true;
          break;
        }
      }
      if (released || !anniversary) continue;

      // (c) notice 30 days before the anniversary if paid months so far + one more renewal (when subscribed) < 3
      if (now >= addDays(anniversary, -FOUNDING.noticeDaysBeforeRelease)) {
        const paidSoFar = await paidMonthsInWindow(tx, userId, addMonths(anniversary, -FOUNDING.termMonths), anniversary);
        const sub = await activeProSubscription(tx, userId);
        if (paidSoFar + (sub ? 1 : 0) < FOUNDING.renewalMinPaidMonthsInTrailing12) {
          const when = await scheduleNotice(tx, userId, seat.seatNo, "renewal_check_30d", anniversary, {
            paidMonths: paidSoFar,
            anniversary: anniversary.toISOString(),
          });
          if (when) out.push({ action: "notice_scheduled", userId, seatNo: seat.seatNo, kind: "renewal_check_30d", scheduledFor: when });
        }
      }
    }
    return out;
  });
}
