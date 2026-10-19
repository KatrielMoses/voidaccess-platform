/**
 * Pricing v1 — the ONLY place prices, credits and plan limits live.
 * Source of truth: docs/PRICING-v1.md (decided 2026-10-12, amendment 1 same day).
 * Change the doc first, then this file. Site, /llms.txt, JSON-LD, app and the
 * credit ledger all import from here.
 */

export const CREDIT_LIST_VALUE_USD = 0.01;

export type Depth = "quick" | "standard" | "deep";
export type PlanId = "free" | "pro" | "pro_plus";
export type Feature =
  | "export_core" // CSV, JSON
  | "export_all" // STIX, MISP, Sigma, YARA, Snort, Suricata, IOC package
  | "history_unlimited"
  | "share_links"
  | "deep"
  | "monitors"
  | "actor_library"
  | "byo_keys"
  | "priority_queue";

export const DEPTHS: Record<Depth, { credits: number; launched: boolean; paidOnly: boolean }> = {
  quick: { credits: 20, launched: true, paidOnly: false },
  standard: { credits: 40, launched: true, paidOnly: false },
  deep: { credits: 50, launched: false, paidOnly: true }, // hidden until crawling ships
};
export const DEFAULT_DEPTH: Depth = "standard";

/** Engine pipeline stages, in execution order (engine runs extract before enrich). */
export const STAGES = ["refine", "collect", "filter", "fetch", "extract", "enrich", "graph", "summarize"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Share of a run's cost per stage (sums to 100), from the E0 stage timings
 * (docs/baseline/E0-REPORT.md §6). Used only for partial refunds on cancel/fail:
 * refund = ceil(credits_charged * weight_of_stages_not_run / 100).
 */
export const STAGE_WEIGHTS: Record<Stage, number> = {
  refine: 2,
  collect: 20,
  filter: 2,
  fetch: 22,
  extract: 26,
  enrich: 18,
  graph: 2,
  summarize: 8,
};

export const ACTIONS = {
  rerun: "same_as_depth",
  monitorCheckCredits: 20, // P1, Pro+ only
  checkToolCredits: 0, // marketing /check, counts only
} as const;

export const CHECK_TOOL_LIMITS = { perIpPerDay: 3, captcha: true, globalMonthlySpendCapUsd: 30 } as const;

export interface Plan {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  annualUsd: number | null;
  monthlyCredits: number;
  historyDays: number | null; // null = unlimited
  features: readonly Feature[];
  topupBonus: number; // extra fraction on top-ups for subscribers
  requiresCard: boolean;
}

const PRO_FEATURES = ["export_core", "export_all", "history_unlimited", "share_links", "deep"] as const;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyUsd: 0,
    annualUsd: null,
    monthlyCredits: 100,
    historyDays: 7,
    features: ["export_core"],
    topupBonus: 0,
    requiresCard: false,
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyUsd: 9,
    annualUsd: 90,
    monthlyCredits: 2000,
    historyDays: null,
    features: PRO_FEATURES,
    topupBonus: 0.2,
    requiresCard: true,
  },
  pro_plus: {
    id: "pro_plus",
    name: "Pro+",
    monthlyUsd: 19,
    annualUsd: 190,
    monthlyCredits: 4500,
    historyDays: null,
    features: [...PRO_FEATURES, "monitors", "actor_library", "byo_keys", "priority_queue"],
    topupBonus: 0.3,
    requiresCard: true,
  },
};

/**
 * Run-creation limits per account (abuse and cost control; credits are the real limiter).
 * Product-tunable, so they live here. Operational timeouts stay in apps/app/lib/limits.ts.
 */
export const RUN_LIMITS = {
  maxConcurrentRuns: 3,
  dailyRunCap: { free: 5, pro: 40, pro_plus: 100 } as Record<PlanId, number>,
} as const;

/** Subscription credits reset monthly, no rollover. Spend order: grant, then top-ups. */
export const ROLLOVER = false;

/**
 * Pay-as-you-go top-ups (decided 2026-10-19): any whole-dollar amount from TOPUP_MIN_USD to TOPUP_MAX_USD,
 * TOPUP_CREDITS_PER_USD credits per dollar, a volume bonus from the listed amounts, then the plan's subscriber
 * bonus (Plan.topupBonus) on top. topupCredits() is the only calculator; checkout, webhook, UI and site use it.
 */
export const TOPUP_MIN_USD = 5;
export const TOPUP_MAX_USD = 500;
export const TOPUP_CREDITS_PER_USD = 100;
/** Highest matching tier wins. */
export const TOPUP_VOLUME_BONUSES = [
  { fromUsd: 25, bonus: 0.1 },
  { fromUsd: 50, bonus: 0.2 },
] as const;
/** Amounts the app offers as one-tap picks (any other whole amount in range is fine too). */
export const TOPUP_QUICK_PICKS_USD = [5, 10, 25, 50] as const;
export const TOPUP_EXPIRY_MONTHS = 12;

/** Founding offer (amendment 1): renewable 12-month term, not lifetime. */
export const FOUNDING = {
  seats: 100,
  plan: "pro" as PlanId,
  monthlyUsd: 7,
  monthlyCredits: 2000,
  termMonths: 12,
  renewalMinPaidMonthsInTrailing12: 3,
  inactivityReleaseMonths: 10,
  noticeDaysBeforeRelease: 30,
  monthlyOnly: true,
  copy: "Founding price $7/mo, kept every year you stay active.",
} as const;

/** Creem (merchant of record): 3.9% + $0.40 per transaction. */
export const PAYMENT_FEE = { percent: 0.039, fixedUsd: 0.4 } as const;

export type TopupAmountError = "not_whole_dollars" | "below_minimum" | "above_maximum";

/** Why an amount can't be bought, or null if it can. */
export function topupAmountError(usd: number): TopupAmountError | null {
  if (!Number.isInteger(usd)) return "not_whole_dollars";
  if (usd < TOPUP_MIN_USD) return "below_minimum";
  if (usd > TOPUP_MAX_USD) return "above_maximum";
  return null;
}

export const isValidTopupUsd = (usd: number) => topupAmountError(usd) === null;

/** The volume-bonus fraction for an amount (0 below the first tier). */
export function topupVolumeBonus(usd: number): number {
  let b = 0;
  for (const t of TOPUP_VOLUME_BONUSES) if (usd >= t.fromUsd) b = Math.max(b, t.bonus);
  return b;
}

export interface TopupBreakdown {
  usd: number;
  /** credits at the base rate */
  base: number;
  /** base + volume bonus */
  withVolume: number;
  volumeBonusPct: number;
  subscriberBonusPct: number;
  /** what the user gets */
  credits: number;
}

/** Integer maths in whole percents, so every caller gets the same number. Throws on an invalid amount. */
export function topupBreakdown(usd: number, plan: PlanId): TopupBreakdown {
  const err = topupAmountError(usd);
  if (err) throw new Error(`Invalid top-up amount $${usd}: ${err}`);
  const base = usd * TOPUP_CREDITS_PER_USD;
  const volumeBonusPct = Math.round(topupVolumeBonus(usd) * 100);
  const subscriberBonusPct = Math.round(PLANS[plan].topupBonus * 100);
  const withVolume = base + Math.floor((base * volumeBonusPct) / 100);
  const credits = withVolume + Math.floor((withVolume * subscriberBonusPct) / 100);
  return { usd, base, withVolume, volumeBonusPct, subscriberBonusPct, credits };
}

/** Credits granted for a top-up of `usd` dollars, including the volume and subscriber bonuses. */
export function topupCredits(usd: number, plan: PlanId): number {
  return topupBreakdown(usd, plan).credits;
}

export function hasFeature(plan: PlanId, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}

export function depthCredits(depth: Depth): number {
  return DEPTHS[depth].credits;
}
