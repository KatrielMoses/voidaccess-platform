import { z } from "zod";

/** The 8 pipeline stages in the order the engine runs them (engine progress/__init__.py: extract BEFORE enrich; contract section 2 lists enrich first). Kept separate so events.ts and metrics.ts don't import each other. */
export const STAGES = [
  "refine",
  "collect",
  "filter",
  "fetch",
  "extract",
  "enrich",
  "graph",
  "summarize",
] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;
export const STAGE_TOTAL = 8 as const;
