import { z } from "zod";
import { Stage } from "./stages";

export const RunMetrics = z.object({
  duration_ms: z.number().nonnegative(),
  tor_bootstrap_ms: z.number().nonnegative(),
  stage_ms: z.partialRecord(Stage, z.number().nonnegative()),
  llm_calls: z.number().int().nonnegative(),
  llm_tokens_in: z.number().int().nonnegative(),
  llm_tokens_out: z.number().int().nonnegative(),
  llm_cost_usd: z.number().nonnegative(),
  pages_fetched: z.number().int().nonnegative(),
  bytes_fetched: z.number().int().nonnegative(),
  enrichment_calls: z.record(z.string(), z.number().int().nonnegative()),
  /** Production runner extras (all optional): peak resident memory of the runner process, MB. */
  peak_rss_mb: z.number().nonnegative().optional(),
  /** Export formats the runner could not produce, with a short reason. The rest of the run is unaffected. */
  export_errors: z.record(z.string(), z.string()).optional(),
  /** Entities left out of the bundle because their engine type is not in the taxonomy, by engine type. */
  dropped_entities: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export type RunMetrics = z.infer<typeof RunMetrics>;
