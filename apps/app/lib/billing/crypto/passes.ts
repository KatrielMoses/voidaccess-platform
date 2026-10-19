/** Shared rules for crypto passes: which subscriptions are card subscriptions, prices, and pass lookups. */
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { cryptoTopupAmountError, PLANS, type PlanId, type TopupAmountError } from "@voidaccess/config";
import { addMonths, subscriptions, type Tx } from "@voidaccess/db";
import { centsToUsd } from "../format";
import type { Interval } from "../catalog";

/** Providers that bill a card and can be asked to cancel, change or open a portal. */
export const CARD_PROVIDERS = ["creem"] as const;
export const CRYPTO_PROVIDER_ID = "nowpayments";
export const isCardProvider = (p: string | null | undefined) =>
  (CARD_PROVIDERS as readonly string[]).includes(p ?? "");

export const LIVE_CARD_STATUSES = ["active", "past_due", "paused"] as const;

export type PassPlan = "pro" | "pro_plus";
export const isPassPlan = (p: unknown): p is PassPlan => p === "pro" || p === "pro_plus";
export const isInterval = (i: unknown): i is Interval => i === "month" || i === "year";

/** Exactly the plan's config price for the interval, or null when the plan has no such price. */
export function passPriceUsd(plan: PassPlan, interval: Interval): number | null {
  const p = PLANS[plan];
  return interval === "year" ? p.annualUsd : p.monthlyUsd;
}

/**
 * A crypto top-up amount from an untrusted body: the same pay-as-you-go rule as card top-ups (whole dollars up to
 * TOPUP_MAX_USD), from CRYPTO_TOPUP_MIN_USD. JSON numbers only (as before P7); anything else is not_whole_dollars.
 */
export function cryptoTopupUsd(
  v: unknown,
): { ok: true; usd: number } | { ok: false; reason: TopupAmountError } {
  const n = typeof v === "number" ? v : NaN;
  const reason = cryptoTopupAmountError(n);
  return reason ? { ok: false, reason } : { ok: true, usd: n };
}

export const addInterval = (d: Date, interval: Interval) => addMonths(d, interval === "year" ? 12 : 1);

export const passTerm = (interval: Interval) => (interval === "year" ? "1 year" : "1 month");

export function orderDescription(
  o: { kind: "topup"; usd: number } | { kind: "pass"; plan: PlanId; interval: Interval },
) {
  return o.kind === "topup"
    ? `VoidAccess credits ${centsToUsd(o.usd * 100)}`
    : `VoidAccess ${PLANS[o.plan].name} pass, ${passTerm(o.interval)} (does not renew)`;
}

export async function liveCardSubscription(tx: Tx, userId: string) {
  const [s] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...LIVE_CARD_STATUSES]),
        inArray(subscriptions.provider, [...CARD_PROVIDERS]),
      ),
    )
    .limit(1);
  return s ?? null;
}

/** The user's crypto pass that is active and not yet over, if any. */
export async function activePass(tx: Tx, userId: string, now: Date, forUpdate = false) {
  const q = tx
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.provider, CRYPTO_PROVIDER_ID),
        eq(subscriptions.status, "active"),
        gt(subscriptions.currentPeriodEnd, now),
      ),
    )
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1);
  const [s] = forUpdate ? await q.for("update") : await q;
  return s ?? null;
}
