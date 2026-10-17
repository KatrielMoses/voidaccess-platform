import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HEADER_SEQ,
  ProgressEvent,
  RunSpec,
  TRACE_CAPS,
  TRACE_KINDS,
  TRACE_TOTAL_CAP,
  checkTrace,
  isTerminalEvent,
  type TraceEvent,
  type TraceKind,
} from "@voidaccess/engine-client";
import { loadFixture } from "./fixtures";
import { startReceiver, type Receiver } from "./receiver";
import { TRACE_FLUSH_EVENTS, runMock, type MockOptions } from "./run";
import { entityDisplay, planTrace } from "./trace-plan";

const secret = "test-secret-0123456789";
let rx: Receiver;
beforeEach(async () => {
  rx = await startReceiver(secret);
});
afterEach(async () => {
  await rx.close();
});

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  run_id: "run-trace-1",
  query: "Cl0p MOVEit ransomware",
  depth: "standard",
  callback_url: `${rx.url}/callback`,
  callback_secret: secret,
  artifact_put_urls: { bundle: `${rx.url}/artifacts/bundle.json`, exports: {} },
  deadline_at: new Date(Date.now() + 60_000).toISOString(),
  ...over,
});

/** Every callback POST as sent (raw body + signed seq), in delivery order. */
interface Sent {
  seq: number;
  body: { events?: unknown[]; seq?: number; type?: string };
}
async function run(opts: MockOptions, over: Partial<RunSpec> = {}) {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (init?.method === "POST" && String(input).endsWith("/callback"))
      sent.push({ seq: Number(headers.get(HEADER_SEQ)), body: JSON.parse(String(init.body)) });
    return fetch(input, init);
  };
  const result = await runMock(spec(over), { durationMs: 2000, ...opts, fetchImpl });
  const raw = sent.flatMap((s) => s.body.events ?? []);
  return { result, sent, raw, traces: rx.traces };
}

const ofKind = <K extends TraceKind>(ts: TraceEvent[], k: K) =>
  ts.filter((t): t is Extract<TraceEvent, { kind: K }> => t.kind === k);
const strictlyIncreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);

function checkIds(ts: TraceEvent[]) {
  const found = new Set(ofKind(ts, "url.found").map((t) => t.data.url_id));
  const kept = new Set<string>();
  const decided = new Set<string>();
  for (const t of [...ofKind(ts, "url.kept"), ...ofKind(ts, "url.dropped")]) {
    expect(found.has(t.data.url_id)).toBe(true);
    expect(decided.has(t.data.url_id)).toBe(false); // one decision per url
    decided.add(t.data.url_id);
  }
  for (const t of ofKind(ts, "url.kept")) kept.add(t.data.url_id);
  const fetchedOk = new Set<string>();
  for (const t of ofKind(ts, "page.fetched")) {
    expect(kept.has(t.data.url_id)).toBe(true);
    if (t.data.outcome === "ok") fetchedOk.add(t.data.url_id);
  }
  for (const t of ofKind(ts, "page.entities")) expect(fetchedOk.has(t.data.url_id)).toBe(true);
  for (const t of ofKind(ts, "entity.found")) expect(fetchedOk.has(t.data.url_id!)).toBe(true);
  // every id event comes after the event that introduced the id
  const seqOf = new Map(ofKind(ts, "url.found").map((t) => [t.data.url_id, t.seq]));
  for (const t of ts)
    if ("url_id" in t.data && t.kind !== "url.found")
      expect(t.seq).toBeGreaterThan(seqOf.get(t.data.url_id as string)!);
}

describe("trace planner", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const { bundle } = loadFixture("lockbit-deep");
    const a = planTrace(bundle, { seed: "run-a", level: true });
    expect(planTrace(bundle, { seed: "run-a", level: true })).toEqual(a);
    expect(planTrace(bundle, { seed: "run-b", level: true })).not.toEqual(a);
  });

  it("entity displays are masked display forms", () => {
    expect(entityDisplay({ type: "URL", display_value: "https://word-ab12.example.net/0afe" })).toBe(
      "word-ab12.example[.]net",
    );
    expect(entityDisplay({ type: "ONION_URL", display_value: `http://${"a".repeat(55)}d.onion/p/1` })).toBe(
      "aaaaaaaa…aaad[.]onion",
    );
    expect(entityDisplay({ type: "EMAIL_ADDRESS", display_value: "alice99@example.org" })).toBe(
      "a***@example.org",
    );
    expect(entityDisplay({ type: "X", display_value: "<b>" })).toBe("b");
    expect(entityDisplay({ type: "X", display_value: "<>" })).toBe("[x]");
    expect(entityDisplay({ type: "X", display_value: "y".repeat(200) })).toHaveLength(80);
  });
});

describe("mock engine: contract v2 trace", () => {
  it("trace on: valid, signed, ordered batches with a realistic run", async () => {
    const { result, sent, raw, traces } = await run({ trace: true, fixture: "dprk-deep-typed" });
    expect(result.terminal).toBe("completed");
    expect(rx.rejected).toEqual([]);

    // every raw event is a known, valid trace event (not ignored)
    for (const e of raw) expect(checkTrace(e)).toMatchObject({ ok: true });
    expect(traces).toHaveLength(raw.length);
    expect(result.traceEventsSent).toBe(raw.length);
    expect(raw.length).toBeGreaterThanOrEqual(800);
    expect(raw.length).toBeLessThanOrEqual(1500);

    // batches: 1..50 events, signed with the last seq; all seqs strictly increase in delivery order
    const batches = sent.filter((s) => s.body.events);
    expect(batches.length).toBe(result.traceBatchesSent);
    for (const b of batches) {
      expect(b.body.events!.length).toBeGreaterThanOrEqual(1);
      expect(b.body.events!.length).toBeLessThanOrEqual(TRACE_FLUSH_EVENTS);
      expect(b.seq).toBe((b.body.events!.at(-1) as { seq: number }).seq);
    }
    expect(batches.some((b) => b.body.events!.length < TRACE_FLUSH_EVENTS)).toBe(true);
    const delivered = sent.flatMap((s) =>
      s.body.events ? s.body.events.map((e) => (e as { seq: number }).seq) : [s.body.seq!],
    );
    expect(strictlyIncreasing(delivered)).toBe(true);
    expect(delivered).toEqual(delivered.map((_, i) => i + 1)); // no gaps: capped items take no seq
    expect(rx.seqLog).toEqual(delivered);

    // progress events: schema 2 stamped, still valid ProgressEvents, one terminal, last
    for (const e of rx.events) {
      expect(e.schema).toBe(2);
      expect(ProgressEvent.safeParse(e).success).toBe(true);
    }
    expect(rx.events.filter(isTerminalEvent)).toHaveLength(1);
    expect(delivered.at(-1)).toBe(rx.events.at(-1)!.seq);

    // trace events carry the stage they were emitted in, in pipeline order
    const stageOf = (k: TraceKind) => new Set(traces.filter((t) => t.kind === k).map((t) => t.stage));
    expect([...stageOf("search.result")]).toEqual(["collect"]);
    expect([...stageOf("url.kept")]).toEqual(["filter"]);
    expect([...stageOf("page.fetched")]).toEqual(["fetch"]);
    expect([...stageOf("entity.found")]).toEqual(["extract"]);

    checkIds(traces);

    // realistic content
    const dropped = ofKind(traces, "url.dropped");
    const fetched = ofKind(traces, "page.fetched");
    const outcomes = new Set(fetched.map((t) => t.data.outcome));
    for (const o of ["ok", "http_404", "timeout", "tor_error", "safety_dropped"] as const)
      expect(outcomes.has(o)).toBe(true);
    const reasons = new Set(dropped.map((t) => t.data.reason));
    for (const r of ["duplicate", "irrelevant", "safety"] as const) expect(reasons.has(r)).toBe(true);
    const keptShare = ofKind(traces, "url.kept").length / ofKind(traces, "url.found").length;
    expect(keptShare).toBeGreaterThan(0.15);
    expect(keptShare).toBeLessThan(0.25);
    expect(new Set(ofKind(traces, "search.result").map((t) => t.data.status))).toEqual(
      new Set(["ok", "timeout", "error", "disabled"]),
    );
    // engine names as the engine writes them, spaces and brackets included
    expect(ofKind(traces, "search.request").some((t) => /[ ()]/.test(t.data.engine))).toBe(true);
    // a page read ok and later removed by the post-scrape safety gate: the latest outcome wins
    const outcomesOf = new Map<string, string[]>();
    for (const t of fetched)
      outcomesOf.set(t.data.url_id, [...(outcomesOf.get(t.data.url_id) ?? []), t.data.outcome]);
    const regated = [...outcomesOf.values()].filter((o) => o.length > 1);
    expect(regated).toEqual([["ok", "safety_dropped"]]);

    // real duplicates: same host found by two different engines, the later one dropped as duplicate
    const found = ofKind(traces, "url.found");
    const byId = new Map(found.map((t) => [t.data.url_id, t.data]));
    for (const d of dropped.filter((t) => t.data.reason === "duplicate")) {
      const dup = byId.get(d.data.url_id)!;
      const orig = found.find(
        (f) => f.data.host === dup.host && f.data.url_id !== dup.url_id && f.data.engine !== dup.engine,
      );
      expect(orig).toBeDefined();
    }
    expect(found.some((f) => f.data.depth === 1 && f.data.engine === undefined)).toBe(true);
    for (const f of found) expect(f.data.host).toMatch(/\[\.\](onion|[a-z]+)$/);
    expect(found.some((f) => f.data.host.startsWith("********"))).toBe(true); // a masked onion name

    // safety drops carry nothing but the id and the reason/outcome (as sent, not just after sanitizing)
    const rawSafety = raw.filter((e) => {
      const d = (e as { data: { reason?: string; outcome?: string } }).data;
      return d.reason === "safety" || d.outcome === "safety_dropped";
    });
    expect(rawSafety.length).toBeGreaterThanOrEqual(4);
    for (const e of rawSafety) {
      const d = (e as { data: Record<string, unknown> }).data;
      expect(Object.keys(d).sort()).toEqual("reason" in d ? ["reason", "url_id"] : ["outcome", "url_id"]);
      // its url.found went out earlier, with a host (the app scrubs it later)
      expect(byId.get(d.url_id as string)?.host).toBeTruthy();
    }

    // counts follow the trace
    const last = rx.events.at(-1)!;
    expect(last.counts?.results_found).toBe(found.length);
    expect(last.counts?.pages_fetched).toBe([...outcomesOf.values()].filter((o) => o.at(-1) === "ok").length);
    expect(last.counts?.entities_found).toBe(ofKind(traces, "entity.found").length);
    expect(rx.events.find((e) => e.type === "refined")?.refined_queries).toEqual(
      ofKind(traces, "query.refined").map((t) => t.data.text),
    );
    const fx = loadFixture("dprk-deep-typed").bundle;
    expect(ofKind(traces, "graph.progress").at(-1)!.data).toEqual({
      nodes: fx.entities.length,
      edges: fx.relationships.length,
      communities: fx.communities.length,
    });
    expect(ofKind(traces, "enrich.source").map((t) => t.data.source)).toEqual(
      expect.arrayContaining(Object.keys(fx.metrics.enrichment_calls)),
    );
    expect(ofKind(traces, "summary.status")[0]!.data).toEqual({ kind: "llm", attempt: 1 });
  });

  it('trace "full": per-kind caps, total cap, one trace.truncated per capped kind', async () => {
    const { result, raw, traces } = await run({ trace: "full", fixture: "blackcat-standard-onion" });
    expect(result.terminal).toBe("completed");
    expect(rx.rejected).toEqual([]);
    for (const e of raw) expect(checkTrace(e)).toMatchObject({ ok: true });
    expect(raw.length).toBeLessThanOrEqual(TRACE_TOTAL_CAP);
    expect(raw.length).toBeGreaterThan(2500);
    const n = (k: TraceKind) => traces.filter((t) => t.kind === k).length;
    for (const k of TRACE_KINDS) expect(n(k)).toBeLessThanOrEqual(TRACE_CAPS[k]);
    const trunc = ofKind(traces, "trace.truncated");
    const truncKinds = trunc.map((t) => t.data.kind);
    expect(new Set(truncKinds).size).toBe(truncKinds.length);
    expect(truncKinds).toEqual(expect.arrayContaining(["search.request", "search.result", "entity.found"]));
    for (const t of trunc) expect(n(t.data.kind)).toBe(TRACE_CAPS[t.data.kind]);
    expect(trunc.find((t) => t.data.kind === "search.request")!.data.dropped).toBe(8);
    expect(trunc.find((t) => t.data.kind === "entity.found")!.data.dropped).toBe(75);
    expect(n("url.found")).toBe(600);
    expect(n("page.entities")).toBe(TRACE_CAPS["page.entities"]);
    checkIds(traces);
    expect(strictlyIncreasing(rx.seqLog)).toBe(true);
  });

  it("cancel with trace on: queued traces are delivered before the terminal event", async () => {
    const { result, sent } = await run({ trace: true, mode: "cancel", stopAtStageIndex: 3 });
    expect(result.terminal).toBe("cancelled");
    expect(rx.rejected).toEqual([]);
    expect(sent.at(-1)!.body.type).toBe("cancelled");
    expect(strictlyIncreasing(rx.seqLog)).toBe(true);
    expect(rx.traces.some((t) => t.stage === "fetch")).toBe(true);
    expect(rx.traces.some((t) => t.stage === "extract")).toBe(false);
    checkIds(rx.traces);
  });

  it("trace off (default): no trace events, no batches, no schema stamp", async () => {
    const { result, sent } = await run({});
    expect(result.terminal).toBe("completed");
    expect(result.traceEventsSent).toBe(0);
    expect(rx.traces).toHaveLength(0);
    expect(rx.batches).toHaveLength(0);
    expect(sent.every((s) => !s.body.events)).toBe(true);
    expect(rx.events.every((e) => e.schema === undefined)).toBe(true);
    expect(rx.events.map((e) => e.seq)).toEqual(rx.events.map((_, i) => i + 1));
  });
});
