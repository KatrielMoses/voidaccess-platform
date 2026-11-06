// STUB: replaced by lane PV-S
/**
 * Temporary stand-in for the report-access module (owned by lane PV-S). Same exports as the contract in
 * PREVIEW-COMMON.md, so the UI lane compiles and runs before PV-S lands. Every report reads as "full" here; the real
 * module decides preview vs full from the plan and the run's ledger rows.
 */
export type ReportAccess = "full" | "preview";

export const PREVIEW_ROWS = 2;
export const PREVIEW_SUMMARY_SENTENCES = 3;
export const LOCKED_ERROR = "preview_locked";

export async function getReportAccess(
  _userId: string,
  _runId: string,
  _ctx?: unknown,
): Promise<ReportAccess> {
  return "full";
}

/** "█" x (8..28): the length comes from a hash of the seed, never from the real value. */
export function lockedText(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "█".repeat(8 + ((h >>> 0) % 21));
}
