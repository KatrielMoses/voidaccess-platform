import {
  STAGES,
  STAGE_TOTAL,
  ResultBundle,
  RunSpec,
  TRACE_CAPS,
  TRACE_KINDS,
  TRACE_SCHEMA,
  TRACE_TOTAL_CAP,
  signCallback,
  type ProgressCounts,
  type ProgressEvent,
  type RunMetrics,
  type Stage,
  type TraceBatch,
  type TraceEvent,
  type TraceKind,
} from "@voidaccess/engine-client";
import { defaultFixtureFor, loadFixture } from "./fixtures";
import { planTrace, type PlannedTrace, type TraceEffect } from "./trace-plan";

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
  /**
   * Contract v2 trace events. false (default): v1 behaviour, no trace and no `schema` stamp. true: a realistic
   * run (~1000-1300 trace events). "full": volume pushed to the per-kind caps (close to TRACE_TOTAL_CAP).
   */
  trace?: boolean | "full";
}

/** Batch flush rules (contract v2): at this many events, or this long after the batch's first event. */
export const TRACE_FLUSH_EVENTS = 50;
export const TRACE_FLUSH_MS = 300;

export interface MockResult {
  terminal: "completed" | "failed" | "cancelled";
  reason?: ProgressEvent["reason"];
  /** Non-trace events posted (one POST each). */
  eventsSent: number;
  /** Trace events posted (in batches), including `trace.truncated`. */
  traceEventsSent: number;
  /** Trace batches posted. */
  traceBatchesSent: number;
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

  // ---- contract v2 trace: caps, batching (delivery order == seq order: one sequential poster)
  const traceOn = Boolean(opts.trace);
  let traceSent = 0;
  let batchesSent = 0;
  let buffer: TraceEvent[] = [];
  let bufferSince = 0;
  const kindCount = new Map<TraceKind, number>();
  const kindDropped = new Map<TraceKind, number>();
  const truncReported = new Set<TraceKind>();
  let traceTotal = 0;

  async function flushTrace(): Promise<void> {
    if (!buffer.length) return;
    const events = buffer;
    buffer = [];
    const batch: TraceBatch = { schema: TRACE_SCHEMA, run_id: spec.run_id, events };
    const raw = JSON.stringify(batch);
    await post(
      spec.callback_url,
      raw,
      signCallback({
        secret: spec.callback_secret,
        runId: spec.run_id,
        seq: events.at(-1)!.seq,
        rawBody: raw,
      }),
    );
    traceSent += events.length;
    batchesSent++;
  }

  /** Queue one trace event, enforcing per-kind caps and the run total (room is kept for `trace.truncated`). */
  async function pushTrace(stage: Stage, t: Pick<PlannedTrace, "kind" | "data">): Promise<void> {
    const n = kindCount.get(t.kind) ?? 0;
    const reserve = t.kind === "trace.truncated" ? 0 : TRACE_KINDS.length;
    if (n >= TRACE_CAPS[t.kind] || traceTotal >= TRACE_TOTAL_CAP - reserve) {
      kindDropped.set(t.kind, (kindDropped.get(t.kind) ?? 0) + 1);
      return;
    }
    kindCount.set(t.kind, n + 1);
    traceTotal++;
    if (!buffer.length) bufferSince = Date.now();
    buffer.push({
      type: "trace",
      schema: TRACE_SCHEMA,
      run_id: spec.run_id,
      seq: ++seq,
      at: iso(),
      stage,
      kind: t.kind,
      data: t.data,
    } as TraceEvent);
    if (buffer.length >= TRACE_FLUSH_EVENTS) await flushTrace();
  }

  /** One `trace.truncated` per kind that hit its cap (emitted at the end of the stage that overflowed). */
  async function reportTruncations(stage: Stage): Promise<void> {
    for (const [kind, dropped] of kindDropped) {
      if (truncReported.has(kind) || kind === "trace.truncated") continue;
      truncReported.add(kind);
      await pushTrace(stage, { kind: "trace.truncated", data: { kind, dropped } });
    }
  }

  /** Sleep until `until`, flushing the pending batch when its 300 ms window closes. */
  async function waitUntil(until: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      const flushAt = buffer.length ? bufferSince + TRACE_FLUSH_MS : Infinity;
      if (flushAt <= now) {
        await flushTrace();
        continue;
      }
      if (now >= until) return;
      await sleep(Math.min(until, flushAt) - now);
    }
  }

  async function emit(e: Omit<ProgressEvent, "run_id" | "seq" | "at" | "stage_total">): Promise<void> {
    if (traceOn) await flushTrace(); // non-trace events never overtake queued trace events
    const event: ProgressEvent = {
      ...(traceOn ? { schema: TRACE_SCHEMA } : {}),
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

  const sentCounts = () => ({ eventsSent: sent, traceEventsSent: traceSent, traceBatchesSent: batchesSent });

  // G9: a blocked query fails before any collection starts.
  if (mode === "blocked") {
    await emit({
      type: "failed",
      reason: "blocked_query",
      message: "Query blocked by content policy",
      stages_completed: [],
    });
    return { terminal: "failed", reason: "blocked_query", ...sentCounts() };
  }

  const { bundle: fx, counts: finalCounts } = loadFixture(opts.fixture ?? defaultFixtureFor(spec.depth));
  const stopAt = opts.stopAtStageIndex ?? 4;
  const plan = traceOn
    ? planTrace(fx, {
        seed: `${spec.run_id}:${opts.fixture ?? defaultFixtureFor(spec.depth)}`,
        level: opts.trace === "full" ? "full" : true,
      })
    : undefined;
  // with traces on, results/pages/entities follow the trace (url.found, ok fetches, entity.found)
  const live: Record<TraceEffect, number> = { result: 0, page: 0, entity: 0 };
  const scale = (k: keyof ProgressCounts, f: number) => Math.round(finalCounts[k] * f);
  const countsAt = (f: number): ProgressCounts => ({
    sources_queried: scale("sources_queried", Math.min(1, f * 3)),
    results_found: plan ? live.result : scale("results_found", Math.min(1, f * 1.6)),
    pages_fetched: plan ? live.page : scale("pages_fetched", Math.max(0, (f - 0.25) * 1.6)),
    entities_found: plan ? live.entity : scale("entities_found", Math.max(0, (f - 0.4) * 1.9)),
    actors_found: scale("actors_found", Math.max(0, (f - 0.45) * 1.8)),
  });
  const stageMs: Partial<Record<Stage, number>> = {};
  let elapsedShare = 0;

  const terminalEarly = async (type: "failed" | "cancelled"): Promise<MockResult> => {
    const reason = type === "failed" ? "error" : "cancelled";
    if (curStage) await reportTruncations(curStage);
    await emit({
      type,
      reason,
      message: type === "failed" ? "Mock failure injected" : "Run cancelled",
      stages_completed: [...completed],
      counts: countsAt(elapsedShare),
      metrics: partialMetrics(),
    });
    return { terminal: type, reason, ...sentCounts() };
  };
  let curStage: Stage | undefined;
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
      return { terminal: "failed", reason: "deadline", ...sentCounts() };
    }
    const stageTotalMs = STAGE_WEIGHT[stage] * total;
    const t0 = Date.now();
    curStage = stage;
    await emit({ type: "stage", stage, stage_index: i + 1, status: "start", message: STAGE_MESSAGE[stage] });
    if (stage === "refine")
      await emit({
        type: "refined",
        stage,
        stage_index: i + 1,
        refined_queries: plan ? plan.queries : fx.refined_queries,
      });

    // trace items play at their planned offset inside the stage (bursty); batches flush on the 300 ms rule
    const items = plan?.stages[stage] ?? [];
    let next = 0;
    const playUntil = async (frac: number) => {
      while (next < items.length && items[next]!.at < frac) {
        const it = items[next++]!;
        await waitUntil(t0 + it.at * stageTotalMs);
        await pushTrace(stage, it);
        if (it.effect) live[it.effect]++;
      }
      await waitUntil(t0 + frac * stageTotalMs);
    };

    // counts tick a few times inside the stage; checkpoints inside the loop
    const ticks = 3;
    for (let t = 1; t <= ticks; t++) {
      if (plan) await playUntil(t === ticks ? 1 : t / ticks);
      else await sleep(stageTotalMs / ticks);
      elapsedShare =
        STAGES.slice(0, i).reduce((a, s) => a + STAGE_WEIGHT[s], 0) + (STAGE_WEIGHT[stage] * t) / ticks;
      if (opts.signal?.aborted || (mode === "cancel" && i === stopAt && t === 2))
        return terminalEarly("cancelled");
      if (mode === "failure" && i === stopAt && t === 2) return terminalEarly("failed");
      if (t < ticks)
        await emit({ type: "counts", stage, stage_index: i + 1, counts: countsAt(elapsedShare) });
    }
    if (plan) await reportTruncations(stage);
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
    counts: plan ? { ...finalCounts, ...plan.totals } : finalCounts,
    metrics: bundle.metrics,
  });
  return { terminal: "completed", ...sentCounts(), bundle };
}
