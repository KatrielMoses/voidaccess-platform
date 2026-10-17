import { RunSpec } from "@voidaccess/engine-client";
import { runMock } from "@voidaccess/engine-mock";
import { getEnv } from "../../env";
import type { LaunchRequest, RunLauncher } from "./types";

export type MockEngineMode = "success" | "failure" | "cancel" | "blocked" | "deadline";

export interface MockLauncherOptions {
  /** Default: MOCK_ENGINE_MODE (read at each launch). */
  mode?: MockEngineMode;
  /** Default: MOCK_ENGINE_DURATION_MS (60s). Tests use a few hundred ms. */
  durationMs?: number;
  /** Default: MOCK_ENGINE_TRACE ("on"). Contract-v2 trace events: false | true | "full". */
  trace?: boolean | "full";
  /** All HTTP the mock engine does (spec fetch, callbacks, bundle PUT). Tests route this to the handlers. */
  fetchImpl?: typeof fetch;
}

/**
 * Runs packages/engine-mock in-process, exactly like the real engine would: it fetches the RunSpec from the
 * spec URL, then posts HMAC-signed callbacks to the app's own callback route and PUTs the bundle to the
 * app's mock artifact route. Aborting the AbortSignal on cancel() is the SIGTERM analogue.
 * `deadline` mode is not a mock-engine mode: the launcher hands the engine an already-expired deadline.
 * If the spec fetch fails the mock just logs and stops, like a container that crashed on boot: the watchdog
 * then fails the run.
 */
export class MockLauncher implements RunLauncher {
  private readonly running = new Map<string, { ac: AbortController; done: Promise<void> }>();
  constructor(private readonly opts: MockLauncherOptions = {}) {}

  async launch(req: LaunchRequest): Promise<{ executionId: string }> {
    const executionId = `mock-${req.runId}`;
    const env = getEnv();
    const mode = this.opts.mode ?? env.MOCK_ENGINE_MODE;
    const durationMs = this.opts.durationMs ?? env.MOCK_ENGINE_DURATION_MS;
    const traceEnv = env.MOCK_ENGINE_TRACE;
    const trace = this.opts.trace ?? (traceEnv === "full" ? "full" : traceEnv === "on");
    const doFetch = this.opts.fetchImpl ?? fetch;
    const ac = new AbortController();
    const done = (async () => {
      const res = await doFetch(req.specUrl);
      if (!res.ok) throw new Error(`spec fetch failed: HTTP ${res.status}`);
      const spec = RunSpec.parse(await res.json());
      if (mode === "deadline") spec.deadline_at = new Date(Date.now() - 1000).toISOString();
      await runMock(spec, {
        mode: mode === "deadline" ? "success" : mode,
        durationMs,
        signal: ac.signal,
        fetchImpl: doFetch,
        retries: 2,
        trace,
      });
    })()
      .catch((e) => console.error(`mock engine ${req.runId}:`, e instanceof Error ? e.message : e))
      .finally(() => this.running.delete(executionId));
    this.running.set(executionId, { ac, done });
    return { executionId };
  }

  async cancel(executionId: string): Promise<void> {
    this.running.get(executionId)?.ac.abort();
  }

  /** Resolves when every mock execution started so far has finished (tests). */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running.values()].map((r) => r.done));
  }
}
