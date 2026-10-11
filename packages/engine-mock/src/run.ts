import {
  STAGES,
  STAGE_TOTAL,
  ResultBundle,
  RunSpec,
  signCallback,
  type ProgressCounts,
  type ProgressEvent,
  type RunMetrics,
  type Stage,
} from "@voidaccess/engine-client";
import { defaultFixtureFor, loadFixture } from "./fixtures";

export type MockMode = "success" | "failure" | "cancel" | "blocked";

export interface MockOptions {
  mode?: MockMode;
  /** Total wall time to spread events over. Default 60_000; ~2_000 in tests. */
  durationMs?: number;
  fixture?: string;
  /** Mode failure/cancel: stage (0-based index into STAGES) during which it stops. Default 4 (extract). */
  stopAtStageIndex?: number;
  /** Also PUT small placeholder exports to the export URLs. */
  writeExports?: boolean;
  /** Aborting this signal behaves like SIGTERM: emit `cancelled` at the next checkpoint. */
  signal?: AbortSignal;
  /** Callback retry attempts (exponential backoff 50ms base). */
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface MockResult {
  terminal: "completed" | "failed" | "cancelled";
  reason?: ProgressEvent["reason"];
  eventsSent: number;
  bundle?: ResultBundle;
}

/** Share of total time per stage (sums to 1), roughly mirroring measured stage_ms. */
const STAGE_WEIGHT: Record<Stage, number> = {
  refine: 0.03,
  collect: 0.2,
  filter: 0.04,
  fetch: 0.17,
  extract: 0.25,
  enrich: 0.12,
  graph: 0.02,
  summarize: 0.17,
};
const STAGE_MESSAGE: Record<Stage, string> = {
  refine: "Refining query",
  collect: "Collecting sources",
  filter: "Filtering results",
  fetch: "Fetching pages",
  extract: "Extracting entities",
  enrich: "Enriching indicators",
  graph: "Building graph",
  summarize: "Writing summary",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = () => new Date().toISOString();

export async function runMock(rawSpec: RunSpec, opts: MockOptions = {}): Promise<MockResult> {
  const spec = RunSpec.parse(rawSpec);
  const mode = opts.mode ?? "success";
  const total = opts.durationMs ?? 60_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const startedAt = new Date();
  let seq = 0;
  let sent = 0;
  const completed: Stage[] = [];

  async function post(
    url: string,
    body: string,
    headers: Record<string, string>,
    method = "POST",
  ): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= (opts.retries ?? 3); attempt++) {
      try {
        const res = await doFetch(url, {
          method,
          body,
          headers: { "content-type": "application/json", ...headers },
        });
        if (res.ok) return;
        if (res.status >= 400 && res.status < 500)
          throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
        if (e instanceof Error && e.message.startsWith("HTTP 4")) throw e;
      }
      await sleep(50 * 2 ** attempt);
    }
    throw lastErr instanceof Error ? lastErr : new Error("callback failed");
  }

  async function emit(e: Omit<ProgressEvent, "run_id" | "seq" | "at" | "stage_total">): Promise<void> {
    const event: ProgressEvent = {
      run_id: spec.run_id,
      seq: ++seq,
      at: iso(),
      stage_total: STAGE_TOTAL,
      ...e,
    };
    const raw = JSON.stringify(event);
    await post(
      spec.callback_url,
      raw,
      signCallback({ secret: spec.callback_secret, runId: spec.run_id, seq: event.seq, rawBody: raw }),
    );
    sent++;
  }

  // G9: a blocked query fails before any collection starts.
  if (mode === "blocked") {
    await emit({
      type: "failed",
      reason: "blocked_query",
      message: "Query blocked by content policy",
      stages_completed: [],
    });
    return { terminal: "failed", reason: "blocked_query", eventsSent: sent };
  }

  const { bundle: fx, counts: finalCounts } = loadFixture(opts.fixture ?? defaultFixtureFor(spec.depth));
  const stopAt = opts.stopAtStageIndex ?? 4;
  const scale = (k: keyof ProgressCounts, f: number) => Math.round(finalCounts[k] * f);
  const countsAt = (f: number): ProgressCounts => ({
    sources_queried: scale("sources_queried", Math.min(1, f * 3)),
    results_found: scale("results_found", Math.min(1, f * 1.6)),
    pages_fetched: scale("pages_fetched", Math.max(0, (f - 0.25) * 1.6)),
    entities_found: scale("entities_found", Math.max(0, (f - 0.4) * 1.9)),
    actors_found: scale("actors_found", Math.max(0, (f - 0.45) * 1.8)),
  });
  const stageMs: Partial<Record<Stage, number>> = {};
  let elapsedShare = 0;

  const terminalEarly = async (type: "failed" | "cancelled"): Promise<MockResult> => {
    const reason = type === "failed" ? "error" : "cancelled";
    await emit({
      type,
      reason,
      message: type === "failed" ? "Mock failure injected" : "Run cancelled",
      stages_completed: [...completed],
      counts: countsAt(elapsedShare),
      metrics: partialMetrics(),
    });
    return { terminal: type, reason, eventsSent: sent };
  };
  const partialMetrics = (): RunMetrics => ({
    ...fx.metrics,
    duration_ms: Date.now() - startedAt.getTime(),
    stage_ms: { ...stageMs },
  });

  for (const [i, stage] of STAGES.entries()) {
    if (opts.signal?.aborted) return terminalEarly("cancelled");
    if (new Date(spec.deadline_at).getTime() < Date.now()) {
      await emit({
        type: "failed",
        reason: "deadline",
        message: "Deadline reached",
        stages_completed: [...completed],
        metrics: partialMetrics(),
      });
      return { terminal: "failed", reason: "deadline", eventsSent: sent };
    }
    const stageTotalMs = STAGE_WEIGHT[stage] * total;
    const t0 = Date.now();
    await emit({ type: "stage", stage, stage_index: i + 1, status: "start", message: STAGE_MESSAGE[stage] });
    if (stage === "refine")
      await emit({ type: "refined", stage, stage_index: i + 1, refined_queries: fx.refined_queries });

    // counts tick a few times inside the stage; checkpoints inside the loop
    const ticks = 3;
    for (let t = 1; t <= ticks; t++) {
      await sleep(stageTotalMs / ticks);
      elapsedShare =
        STAGES.slice(0, i).reduce((a, s) => a + STAGE_WEIGHT[s], 0) + (STAGE_WEIGHT[stage] * t) / ticks;
      if (opts.signal?.aborted || (mode === "cancel" && i === stopAt && t === 2))
        return terminalEarly("cancelled");
      if (mode === "failure" && i === stopAt && t === 2) return terminalEarly("failed");
      if (t < ticks)
        await emit({ type: "counts", stage, stage_index: i + 1, counts: countsAt(elapsedShare) });
    }
    const dur = Date.now() - t0;
    stageMs[stage] = dur;
    completed.push(stage);
    await emit({
      type: "stage",
      stage,
      stage_index: i + 1,
      status: "end",
      duration_ms: dur,
      counts: countsAt(elapsedShare),
    });
  }

  // Bundle goes up BEFORE `completed` (contract section 3).
  const bundle: ResultBundle = ResultBundle.parse({
    ...fx,
    run_id: spec.run_id,
    query: spec.query,
    depth: spec.depth,
    started_at: startedAt.toISOString(),
    completed_at: iso(),
    metrics: { ...fx.metrics, duration_ms: Date.now() - startedAt.getTime(), stage_ms: stageMs },
  });
  await post(spec.artifact_put_urls.bundle, JSON.stringify(bundle), {}, "PUT");
  if (opts.writeExports) {
    for (const [kind, url] of Object.entries(spec.artifact_put_urls.exports)) {
      await post(
        url,
        JSON.stringify({ mock: true, kind, run_id: spec.run_id, entities: bundle.entities.length }),
        {},
        "PUT",
      );
    }
  }
  await emit({
    type: "completed",
    message: "Run completed",
    stages_completed: [...completed],
    counts: finalCounts,
    metrics: bundle.metrics,
  });
  return { terminal: "completed", eventsSent: sent, bundle };
}
