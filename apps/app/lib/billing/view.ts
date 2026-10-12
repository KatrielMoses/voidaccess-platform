/** Server-side assembly of everything the /billing page shows. All numbers come from @voidaccess/config. */
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { FOUNDING, PLANS, TOPUPS, topupCredits, type PlanId } from "@voidaccess/config";
import { availableSeats, foundingNotices, getDatabase, type Database } from "@voidaccess/db";
import { desiredCatalog, FOUNDING_KEY, type Interval } from "./catalog";
import { currentSubscription, foundingState } from "./plan-ops";

export interface PlanView {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  annualUsd: number | null;
  credits: number;
  historyDays: number | null;
  features: string[];
  requiresCard: boolean;
}

export interface BillingView {
  plan: PlanId;
  sub: null | {
    productKey: string | null;
    plan: PlanId;
    interval: Interval;
    status: string;
    currentPeriodEnd: string | null;
    cancelAt: string | null;
    pending: null | { plan: PlanId; interval: Interval; at: string | null };
    isFounding: boolean;
  };
  founding: {
    held: boolean;
    seatNo?: number;
    termEnd?: string | null;
    status?: "renews" | "at_risk";
    releasingOn?: string | null;
  };
  seats: { available: number; total: number };
  canClaimFounding: boolean;
  plans: PlanView[];
  topups: { usd: number; baseCredits: number; credits: number; bonusPct: number }[];
}

export async function loadBillingView(
  userId: string,
  plan: PlanId,
  database: Database = getDatabase(),
): Promise<BillingView> {
  const [sub, fs, available] = await Promise.all([
    currentSubscription(userId, database),
    foundingState(userId, database),
    availableSeats({ database }),
  ]);
  const pend = sub?.pendingProductKey
    ? desiredCatalog().find((e) => e.key === sub.pendingProductKey)
    : undefined;

  let founding: BillingView["founding"] = { held: fs.held };
  if (fs.held) {
    // at risk when a 30-day warning (renewal or inactivity) is scheduled for a future release date
    const notices = await database.withUser(userId, (tx) =>
      tx
        .select({ refAt: foundingNotices.refAt })
        .from(foundingNotices)
        .where(
          and(
            eq(foundingNotices.userId, userId),
            inArray(foundingNotices.kind, ["renewal_check_30d", "inactivity_30d"]),
            gt(foundingNotices.refAt, new Date()),
          ),
        )
        .orderBy(desc(foundingNotices.refAt))
        .limit(1),
    );
    founding = {
      held: true,
      seatNo: fs.seatNo,
      termEnd: fs.anniversaryAt?.toISOString() ?? null,
      status: notices[0] ? "at_risk" : "renews",
      releasingOn: notices[0]?.refAt.toISOString() ?? null,
    };
  }

  return {
    plan,
    sub: sub
      ? {
          productKey: sub.productKey,
          plan: sub.plan,
          interval: sub.interval,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          cancelAt: sub.cancelAt?.toISOString() ?? null,
          pending:
            pend && pend.plan && pend.interval
              ? {
                  plan: pend.plan,
                  interval: pend.interval,
                  at: sub.pendingEffectiveAt?.toISOString() ?? null,
                }
              : null,
          isFounding: sub.isFounding || sub.productKey === FOUNDING_KEY,
        }
      : null,
    founding,
    seats: { available, total: FOUNDING.seats },
    canClaimFounding: available > 0 && !fs.held && !sub,
    plans: (["free", "pro", "pro_plus"] as const).map((id) => {
      const p = PLANS[id];
      return {
        id,
        name: p.name,
        monthlyUsd: p.monthlyUsd,
        annualUsd: p.annualUsd,
        credits: p.monthlyCredits,
        historyDays: p.historyDays,
        features: [...p.features],
        requiresCard: p.requiresCard,
      };
    }),
    topups: TOPUPS.map((t) => {
      const credits = topupCredits(t.usd, plan);
      return {
        usd: t.usd,
        baseCredits: t.credits,
        credits,
        bonusPct: Math.round((credits / t.credits - 1) * 100),
      };
    }),
  };
}
