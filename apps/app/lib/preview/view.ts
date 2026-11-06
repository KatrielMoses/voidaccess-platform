/** Reading the preview marker off results payloads (contract: PREVIEW-COMMON.md). Client-safe. */
import type { InvestigationView } from "@/lib/results/types";
import type { AccessView, PreviewTotals, WithAccess } from "./types";

/** The marker on any payload, or null when the payload predates it (read as full). */
export const accessOf = (payload: unknown): AccessView | null =>
  payload && typeof payload === "object" ? ((payload as WithAccess).access ?? null) : null;

/** The summary's counts, for a 402 that arrives on a payload without the marker. */
export function totalsFromInvestigation(inv: InvestigationView): PreviewTotals {
  const byType = inv.summary.entityCounts ?? {};
  const stats = inv.summary.stats;
  return {
    sources: inv.summary.sourceCount ?? stats?.sources ?? 0,
    entities: stats?.entities ?? Object.values(byType).reduce((a, b) => a + b, 0),
    byType,
    actors: stats?.actors ?? 0,
    onions: byType.ONION_URL ?? 0,
    iocs: 0,
    relationships: stats?.relationships ?? 0,
  };
}

/** The summary was cut to its first sentences (`summaryLocked: true`, on the summary or the investigation). */
export function summaryIsLocked(inv: InvestigationView): boolean {
  const a = inv as InvestigationView & { summaryLocked?: boolean; summary: { summaryLocked?: boolean } };
  return a.summaryLocked === true || a.summary.summaryLocked === true;
}
