/**
 * The unlock panel's facts: which price we show (only prices we actually charge, from @voidaccess/config), the counts
 * phrase built from the preview totals, and the return-path check the checkout route uses. Pure: client-safe.
 */
import { FOUNDING, PLANS } from "@voidaccess/config";
import { typeLabel } from "@/lib/results/entity-style";
import type { PreviewTotals } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnlockOffer {
  /** true while founding seats remain and this user can claim one: the founding product at FOUNDING.monthlyUsd */
  founding: boolean;
  /** whole dollars a month */
  priceUsd: number;
}

/**
 * The founding price only while a seat is free and this user could take it (the same rule as Billing's
 * canClaimFounding and createSubscriptionCheckout); otherwise Pro monthly.
 */
export function chooseUnlockOffer(s: {
  seatsAvailable: number;
  holdsSeat: boolean;
  hasSubscription: boolean;
}): UnlockOffer {
  const founding = s.seatsAvailable > 0 && !s.holdsSeat && !s.hasSubscription;
  return { founding, priceUsd: founding ? FOUNDING.monthlyUsd : PLANS.pro.monthlyUsd };
}

/** "$7", "$9": whole dollars, as on the pricing page. */
export const priceLabel = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);

/** Plurals for labels that don't take a plain "s" (the labels themselves come from entity-style). */
const PLURAL: Record<string, string> = {
  Malware: "malware families",
  Email: "emails",
  Phone: "phone numbers",
  Person: "people",
  Telegram: "Telegram handles",
  MD5: "MD5 hashes",
  "SHA-1": "SHA-1 hashes",
  "SHA-256": "SHA-256 hashes",
};
const SINGULAR: Record<string, string> = {
  Malware: "malware family",
  Email: "email",
  Phone: "phone number",
  Person: "person",
  Telegram: "Telegram handle",
  MD5: "MD5 hash",
  "SHA-1": "SHA-1 hash",
  "SHA-256": "SHA-256 hash",
};
/** First words that keep their capital letter (names and acronyms). */
const PROPER =
  /^(Bitcoin|Ethereum|Monero|Telegram|IP|IPv6|CVE|ATT&CK|API|MD5|SHA|PGP|ENS|IPFS|MAC|YARA|Nuclei|Exploit-DB)\b/;

/** "12 Bitcoin wallets", "1 IP address", "6 ransomware groups": the type label in plain words. */
export function countNoun(type: string, n: number): string {
  const label = typeLabel(type);
  const fixed = n === 1 ? SINGULAR[label] : PLURAL[label];
  let word = fixed ?? label;
  if (!fixed) {
    if (!PROPER.test(word)) word = word.charAt(0).toLowerCase() + word.slice(1);
    if (n !== 1)
      word = /(s|x|sh|ch)$/i.test(word)
        ? `${word}es`
        : /[^aeiou]y$/i.test(word)
          ? `${word.slice(0, -1)}ies`
          : `${word}s`;
  }
  return `${n.toLocaleString("en-US")} ${word}`;
}

/**
 * "38 sources, 12 Bitcoin wallets, 6 actors": sources first, then the two largest non-zero entity or actor
 * categories. Empty when nothing was found.
 */
export function countsPhrase(t: PreviewTotals): string {
  const parts: string[] = [];
  if (t.sources > 0)
    parts.push(`${t.sources.toLocaleString("en-US")} ${t.sources === 1 ? "source" : "sources"}`);
  const cats: { n: number; text: string; key: string }[] = Object.entries(t.byType)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => ({ n, key: type, text: countNoun(type, n) }));
  if (t.actors > 0)
    cats.push({
      n: t.actors,
      key: "~actors",
      text: `${t.actors.toLocaleString("en-US")} ${t.actors === 1 ? "actor" : "actors"}`,
    });
  // largest first; ties keep a stable, readable order
  cats.sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
  parts.push(...cats.slice(0, 3 - parts.length).map((c) => c.text));
  return parts.join(", ");
}

/** The results tabs a checkout may return to. */
const RESULT_TABS = ["summary", "graph", "entities", "actors", "sources", "exports"] as const;

/**
 * Validates the path a checkout returns to. Only this app's own report pages qualify:
 * `/investigations/<uuid>`, optionally `/results` and one results tab. No scheme, host, query, fragment, encoded
 * characters, dot segments or backslashes, so it can't become an open redirect. Returns the normalised path or null.
 */
export function safeReturnPath(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 120) return null;
  const m = /^\/investigations\/([0-9a-fA-F-]{36})(?:\/results(?:\/([a-z]+))?)?$/.exec(input);
  if (!m || !UUID_RE.test(m[1]!)) return null;
  if (m[2] !== undefined && !(RESULT_TABS as readonly string[]).includes(m[2])) return null;
  return input.toLowerCase();
}

/** The investigation id inside a validated return path. */
export const investigationOfPath = (path: string): string | null =>
  /^\/investigations\/([0-9a-f-]{36})/.exec(path)?.[1] ?? null;
