import type { Stage } from "@voidaccess/engine-client";

/**
 * Share of a run's cost per engine stage, used for partial refunds on cancel/fail.
 * Derived from the E0 stage timings (docs/baseline/E0-REPORT.md §6). Sums to 100.
 * REQUEST to architect: move into @voidaccess/config next to DEPTHS (ARCHITECTURE §4 expects it there).
 * These are fractions, not prices: credit amounts still come only from config.
 */
export const STAGE_WEIGHTS: Record<Stage, number> = {
  refine: 2,
  collect: 20,
  filter: 2,
  fetch: 22,
  enrich: 18,
  extract: 26,
  graph: 2,
  summarize: 8,
};
