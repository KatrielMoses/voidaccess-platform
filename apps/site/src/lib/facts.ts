import { SUPPORT_EMAIL } from "@content/legal-common";
/**
 * Every price, credit number and plan limit the site can show, derived from
 * @voidaccess/config at build time. Content files refer to these as {{token}}
 * placeholders (see resolve()); nothing here is typed in by hand.
 */
import {
  DEPTHS,
  FOUNDING,
  PLANS,
  TOPUP_CREDITS_PER_USD,
  TOPUP_EXPIRY_MONTHS,
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
  TOPUP_VOLUME_BONUSES,
  topupBreakdown,
  topupCredits,
  type PlanId,
} from "@voidaccess/config";

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const num = (n: number) => n.toLocaleString("en-US");
const pct = (f: number) => `${Math.round(f * 100)}%`;

const standard = DEPTHS.standard.credits;
const quick = DEPTHS.quick.credits;

/** The volume tiers, lowest first: "from $X, +Y%". */
const volumeTiers = [...TOPUP_VOLUME_BONUSES].sort((a, b) => a.fromUsd - b.fromUsd);

function topupFacts() {
  // the worked example: the highest volume tier's amount on Pro, so both bonuses show
  const ex = topupBreakdown(volumeTiers.at(-1)?.fromUsd ?? TOPUP_MIN_USD, "pro");
  return {
    min: usd(TOPUP_MIN_USD),
    max: usd(TOPUP_MAX_USD),
    rate: num(TOPUP_CREDITS_PER_USD),
    expiryMonths: String(TOPUP_EXPIRY_MONTHS),
    /** every tier in one phrase: "+N% from $X, …" */
    volume: volumeTiers.map((t) => `+${pct(t.bonus)} from ${usd(t.fromUsd)}`).join(", "),
    /** tier1, tier2, … as { from, bonus } */
    ...Object.fromEntries(volumeTiers.map((t, i) => [`tier${i + 1}`, { from: usd(t.fromUsd), bonus: pct(t.bonus) }])),
    proBonus: pct(PLANS.pro.topupBonus),
    plusBonus: pct(PLANS.pro_plus.topupBonus),
    example: {
      usd: usd(ex.usd),
      base: num(ex.base),
      volumePct: `${ex.volumeBonusPct}%`,
      withVolume: num(ex.withVolume),
      subscriberPct: `${ex.subscriberBonusPct}%`,
      credits: num(ex.credits),
    },
  };
}

function planFacts(id: PlanId) {
  const p = PLANS[id];
  const annualSavedMonths = p.annualUsd ? Math.round(12 - p.annualUsd / p.monthlyUsd) : 0;
  return {
    name: p.name,
    monthly: usd(p.monthlyUsd),
    annual: p.annualUsd === null ? "" : usd(p.annualUsd),
    annualPerMonth: p.annualUsd === null ? "" : usd(Math.round((p.annualUsd / 12) * 100) / 100),
    credits: num(p.monthlyCredits),
    bonus: pct(p.topupBonus),
    standardRuns: num(Math.floor(p.monthlyCredits / standard)),
    quickRuns: num(Math.floor(p.monthlyCredits / quick)),
    historyDays: p.historyDays === null ? "" : String(p.historyDays),
    monthsFree: String(annualSavedMonths),
  };
}

export const facts = {
  free: planFacts("free"),
  pro: planFacts("pro"),
  plus: planFacts("pro_plus"),
  depth: { quick: String(quick), standard: String(standard) },
  founding: {
    price: usd(FOUNDING.monthlyUsd),
    seats: String(FOUNDING.seats),
    credits: num(FOUNDING.monthlyCredits),
    termMonths: String(FOUNDING.termMonths),
    renewalMonths: String(FOUNDING.renewalMinPaidMonthsInTrailing12),
    inactivityMonths: String(FOUNDING.inactivityReleaseMonths),
    noticeDays: String(FOUNDING.noticeDaysBeforeRelease),
    proPrice: usd(PLANS[FOUNDING.plan].monthlyUsd),
    copy: FOUNDING.copy,
  },
  topup: topupFacts(),
  support: { email: SUPPORT_EMAIL },
} as const;

export type Facts = typeof facts;

/** Replace {{group.key}} tokens. Unknown tokens throw so a typo can't ship silently. */
export function resolve(text: string, f: Facts = facts): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    let cur: unknown = f;
    for (const part of path.split(".")) {
      if (cur && typeof cur === "object" && part in cur) cur = (cur as Record<string, unknown>)[part];
      else throw new Error(`Unknown content token {{${path}}}`);
    }
    if (typeof cur !== "string") throw new Error(`Content token {{${path}}} is not a string`);
    return cur;
  });
}

export const money = usd;
export const number = num;

export interface TopupTier {
  from: string;
  bonus: string;
}

/** Volume-bonus tiers for display, lowest first ({ from, bonus }), bonus with a leading "+". */
export function topupTiers(): TopupTier[] {
  return volumeTiers.map((t) => ({ from: usd(t.fromUsd), bonus: `+${pct(t.bonus)}` }));
}

/** Worked-example amounts, all from config: the minimum, each volume tier's threshold, the maximum. */
export function topupExampleAmounts(): number[] {
  return [...new Set([TOPUP_MIN_USD, ...volumeTiers.map((t) => t.fromUsd), TOPUP_MAX_USD])].sort((a, b) => a - b);
}

export interface TopupRow {
  usd: string;
  volumeBonus: string;
  freeCredits: string;
  proCredits: string;
  plusCredits: string;
}

/** Worked-example rows: credits for each example amount on Free, Pro and Pro+ (topupCredits is the only calculator). */
export function topupRows(): TopupRow[] {
  return topupExampleAmounts().map((a) => {
    const b = topupBreakdown(a, "free");
    return {
      usd: usd(a),
      volumeBonus: b.volumeBonusPct > 0 ? `+${b.volumeBonusPct}%` : "-",
      freeCredits: num(topupCredits(a, "free")),
      proCredits: num(topupCredits(a, "pro")),
      plusCredits: num(topupCredits(a, "pro_plus")),
    };
  });
}
