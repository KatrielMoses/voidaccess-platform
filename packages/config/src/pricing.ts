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

/** Subscription credits reset monthly, no rollover. Spend order: grant, then top-ups. */
export const ROLLOVER = false;

export const TOPUPS = [
  { usd: 10, credits: 1000 },
  { usd: 25, credits: 2750 },
  { usd: 50, credits: 6000 },
] as const;
export const TOPUP_MIN_USD = 10;
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

export const PAYMENT_FEE = { percent: 0.04, fixedUsd: 0.5 } as const;

/** Credits granted for a top-up, including the subscriber bonus. */
export function topupCredits(usd: number, plan: PlanId): number {
  const tier = TOPUPS.find((t) => t.usd === usd);
  if (!tier) throw new Error(`No top-up tier for $${usd}`);
  return Math.floor(tier.credits * (1 + PLANS[plan].topupBonus));
}

export function hasFeature(plan: PlanId, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}

export function depthCredits(depth: Depth): number {
  return DEPTHS[depth].credits;
}
