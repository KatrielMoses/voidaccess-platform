export type Tier = "unconfirmed" | "corroborated" | "feed_validated";

/**
 * The confidence tier from independent sources. "Independent" means distinct source hosts (registrable
 * domains, or whole onion hosts): twenty pages from one site count once, so flooding one host can't raise a tier.
 * A single source never rises above unconfirmed; a licensed public feed match (e.g. CISA KEV) is feed_validated.
 */
export function tierOf(independentSources: number, feedMatch: string | null): Tier {
  if (feedMatch) return "feed_validated";
  return independentSources >= 2 ? "corroborated" : "unconfirmed";
}

export const TIER_RANK: Record<Tier, number> = { unconfirmed: 0, corroborated: 1, feed_validated: 2 };
