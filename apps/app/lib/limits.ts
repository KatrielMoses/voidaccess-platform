/**
 * Run-lifecycle limits. The product-tunable ones (concurrency, daily cap per plan) live in
 * @voidaccess/config RUN_LIMITS; the operational timeouts below stay here. Nothing else in
 * apps/app may hard-code any of them.
 */
import { RUN_LIMITS } from "@voidaccess/config";

/** Max runs in a non-terminal state (reserved, launching, running, ingesting) per account. */
export const MAX_CONCURRENT_RUNS = RUN_LIMITS.maxConcurrentRuns;

/** Runs an account may create in any rolling 24 hours, by plan. Credits are the real limiter. */
export const DAILY_RUN_CAP = RUN_LIMITS.dailyRunCap;

/** A spec URL token is single-use and dies after this long (ENGINE-CONTRACT: 10 minutes at most). */
export const SPEC_TOKEN_TTL_MINUTES = 10;

/** A running/ingesting run with no engine callback for this long is failed and refunded. */
export const WATCHDOG_SILENCE_MINUTES = 10;

/** A run stuck in `launching` with no callback after this long is failed and refunded. */
export const LAUNCHING_STUCK_MINUTES = 8;

/** A run still `reserved` after this long means the process died between reserve and launch. */
export const RESERVED_STUCK_MINUTES = 2;

/** After a cancel request, settle as cancelled by ourselves if the engine's `cancelled` event has not come. */
export const CANCEL_SETTLE_TIMEOUT_SECONDS = 60;

/** The engine must finish by now + this (RunSpec.deadline_at). */
export const RUN_DEADLINE_MINUTES = 30;

/** SSE: how often each open stream polls run_events. */
export const SSE_POLL_INTERVAL_MS = 1500;

export const QUERY_MIN_LENGTH = 3;
export const QUERY_MAX_LENGTH = 500;
export const TITLE_MAX_LENGTH = 200;
