/**
 * ProgressEvent schema: the ONLY place the event shape is defined.
 * E1B may change the engine's hook output; R0 reconciles here (and re-runs `gen:schemas`).
 */
import { z } from "zod";
import { RunMetrics } from "./metrics";
import { Stage, STAGE_TOTAL } from "./stages";

export { STAGES, Stage, STAGE_TOTAL } from "./stages";

export const EventType = z.enum(["stage", "counts", "refined", "completed", "failed", "cancelled"]);
export type EventType = z.infer<typeof EventType>;

export const FailureReason = z.enum(["blocked_query", "no_results", "deadline", "error", "cancelled"]);
export type FailureReason = z.infer<typeof FailureReason>;

export const StageStatus = z.enum(["start", "end", "skipped", "failed"]);
export type StageStatus = z.infer<typeof StageStatus>;

export const ProgressCounts = z.object({
  sources_queried: z.number().int().nonnegative(),
  results_found: z.number().int().nonnegative(),
  pages_fetched: z.number().int().nonnegative(),
  entities_found: z.number().int().nonnegative(),
  actors_found: z.number().int().nonnegative(),
});
export type ProgressCounts = z.infer<typeof ProgressCounts>;

export const ProgressEvent = z.object({
  run_id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime({ offset: true }),
  type: EventType,
  stage: Stage.optional(),
  /** 1-based (1..8), as emitted by the engine hook. */
  stage_index: z.number().int().min(1).max(8).optional(),
  stage_total: z.literal(STAGE_TOTAL),
  refined_queries: z.array(z.string()).optional(),
  counts: ProgressCounts.optional(),
  /** Human label; never raw dark-web text. */
  message: z.string().max(300).optional(),
  /** On failed/cancelled: drives the partial refund. */
  stages_completed: z.array(Stage).optional(),
  reason: FailureReason.optional(),
  metrics: RunMetrics.optional(),
  /** Additive (engine hook): lifecycle of a `stage` event. */
  status: StageStatus.optional(),
  /** Additive (engine hook): on a stage `end`. */
  duration_ms: z.number().int().nonnegative().optional(),
  /** Contract v2 stamps `schema: 2` on every event; v1 events omit it. */
  schema: z.union([z.literal(1), z.literal(2)]).optional(),
});
export type ProgressEvent = z.infer<typeof ProgressEvent>;

export const TERMINAL_EVENT_TYPES: readonly EventType[] = ["completed", "failed", "cancelled"];
export function isTerminalEvent(e: Pick<ProgressEvent, "type">): boolean {
  return TERMINAL_EVENT_TYPES.includes(e.type);
}
