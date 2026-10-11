/**
 * Every price, credit number and plan limit the site can show, derived from
 * @voidaccess/config at build time. Content files refer to these as {{token}}
 * placeholders (see resolve()); nothing here is typed in by hand.
 */
import { DEPTHS, FOUNDING, PLANS, TOPUPS, TOPUP_EXPIRY_MONTHS, TOPUP_MIN_USD, topupCredits, type PlanId } from "@voidaccess/config";

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const num = (n: number) => n.toLocaleString("en-US");
const pct = (f: number) => `${Math.round(f * 100)}%`;

const standard = DEPTHS.standard.credits;
const quick = DEPTHS.quick.credits;

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
  topup: { min: usd(TOPUP_MIN_USD), expiryMonths: String(TOPUP_EXPIRY_MONTHS) },
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

export interface TopupRow {
  usd: string;
  credits: string;
  baseBonus: string;
  proCredits: string;
  plusCredits: string;
}

/** Top-up table rows; the base bonus is measured against the smallest tier's credits per dollar. */
export function topupRows(): TopupRow[] {
  const first = TOPUPS[0];
  const baseRate = first.credits / first.usd;
  return TOPUPS.map((t) => {
    const bonus = Math.round((t.credits / t.usd / baseRate - 1) * 100);
    return {
      usd: usd(t.usd),
      credits: num(t.credits),
      baseBonus: bonus > 0 ? `+${bonus}%` : "-",
      proCredits: num(topupCredits(t.usd, "pro")),
      plusCredits: num(topupCredits(t.usd, "pro_plus")),
    };
  });
}
