import { DEPTHS, FOUNDING, PLANS } from "@voidaccess/config";
import { money } from "@/lib/facts";
import type { Stats } from "@/lib/stats";

/**
 * Placeholders in src/home/index.html. Prices and credit numbers come from @voidaccess/config (never typed into the
 * HTML; the no-hardcoded-prices test scans it), the app's origin from the environment, and the open-source numbers
 * from lib/stats.ts on each request.
 */
export function staticTokens(appUrl: string): Record<string, string> {
  const free = PLANS.free.monthlyCredits;
  return {
    __VA_APP_URL__: appUrl,
    __VA_FREE_CREDITS__: String(free),
    __VA_FREE_QUICK__: String(Math.floor(free / DEPTHS.quick.credits)),
    __VA_FREE_STANDARD__: String(Math.floor(free / DEPTHS.standard.credits)),
    // the headline "from" price is the founding Pro price (owner decision 2026-10-19); the pricing page shows both
    __VA_PRO_PRICE__: money(FOUNDING.monthlyUsd),
  };
}

export function statsTokens(stats: Stats): Record<string, string> {
  return { __VA_STARS__: stats.stars, __VA_DOWNLOADS__: stats.downloads };
}

/** Replaces every `__VA_NAME__` token. Unknown tokens throw, so a typo in the HTML can't ship as visible text. */
export function fill(template: string, tokens: Record<string, string>, { strict = true } = {}): string {
  return template.replace(/__VA_[A-Z_]+?__/g, (t) => {
    if (t in tokens) return tokens[t]!;
    if (strict) throw new Error(`Unknown home page token ${t}`);
    return t;
  });
}
