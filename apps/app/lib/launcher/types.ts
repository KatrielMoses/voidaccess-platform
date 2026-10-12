/**
 * Launcher interface: the seam between the platform and whatever executes an engine run
 * (the in-process mock now, the Cloud Run job in R0).
 *
 * SECURITY (ENGINE-CONTRACT section 1): the launcher gets a REFERENCE to the RunSpec, never the query.
 * The launched engine fetches the RunSpec once from `specUrl`
 * (`GET /api/engine/runs/{run_id}/spec?t=<token>`, single-use, 10 minutes). Nothing a launcher logs,
 * passes as arguments or sets as environment variables can contain the user's query.
 */
export interface LaunchRequest {
  runId: string;
  /** Single-use URL the engine fetches its RunSpec from (contains the one-time token). */
  specUrl: string;
  /** ISO. The engine must finish and emit `failed: deadline` by then (also inside the RunSpec). */
  deadlineAt: string;
}

export interface RunLauncher {
  launch(req: LaunchRequest): Promise<{ executionId: string }>;
  /** Ask the execution to stop (SIGTERM analogue). The engine then emits a `cancelled` event. */
  cancel(executionId: string): Promise<void>;
}
