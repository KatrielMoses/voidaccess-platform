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
});
export type RunMetrics = z.infer<typeof RunMetrics>;
