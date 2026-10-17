import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signCallback, TRACE_CAPS, TRACE_TOTAL_CAP, type TraceEvent } from "@voidaccess/engine-client";
import { runEvents } from "@voidaccess/db";
import * as eventsRoute from "@/app/api/engine/runs/[id]/events/route";
import * as sseRoute from "@/app/api/investigations/[id]/events/route";
import * as replayRoute from "@/app/api/investigations/[id]/replay/route";
import { resetIngest, useNoopIngest } from "@/lib/runs/ingest";
import { deriveCallbackSecret } from "@/lib/runs/secrets";
import { getInvestigation, startInvestigation } from "@/lib/runs/service";
import { applyCaps } from "@/lib/runs/traces";
import { setLauncher } from "@/lib/launcher";
import { APP, StubLauncher, asUser, ctxFor, db, makeUser, postEvent, runRow } from "./helpers";

setLauncher(new StubLauncher());
beforeEach(() => useNoopIngest());
afterEach(() => resetIngest());

const at = () => new Date().toISOString();
const tr = (runId: string, seq: number, kind: string, data: Record<string, unknown>, stage = "collect") => ({
  type: "trace",
  schema: 2,
  run_id: runId,
  seq,
  at: at(),
  stage,
  kind,
  data,
});

async function postBatch(runId: string, events: unknown[], o: { headerSeq?: number } = {}) {
  const raw = JSON.stringify({ schema: 2, run_id: runId, events });
  const last = (events.at(-1) as { seq: number }).seq;
  const headers = signCallback({
    secret: deriveCallbackSecret(runId),
    runId,
    seq: o.headerSeq ?? last,
    rawBody: raw,
  });
  const res = await eventsRoute.POST(
    new Request(`${APP}/api/engine/runs/${runId}/events`, { method: "POST", body: raw, headers }),
    ctxFor(runId),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const traceRows = (id: string) =>
  db().withSystem(
    "test.traces",
    (tx) =>
      tx
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, id), eq(runEvents.type, "trace")))
        .orderBy(runEvents.seq),
    { audit: false },
  );

async function newRun(query = "trace run") {
  const u = await makeUser();
  asUser(u);
  const { id } = await startInvestigation(u, { query, depth: "quick" });
  return { u, id };
}

async function readSse(id: string, lastEventId?: string): Promise<string> {
  const res = await sseRoute.GET(
    new Request(`${APP}/api/investigations/${id}/events`, {
      headers: lastEventId ? { "last-event-id": lastEventId } : {},
    }),
    ctxFor(id),
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

describe("P8-3: trace events on the callback route", () => {
  it("stores a signed batch as type trace with kind + data; a trace moves the run to running", async () => {
    const { id } = await newRun();
    const r = await postBatch(id, [
      tr(id, 1, "search.request", { engine: "ahmia", query_index: 0 }),
      tr(id, 2, "url.found", { url_id: "u1", host: "lockbit3…xyz7[.]onion", engine: "ahmia", depth: 0 }),
      tr(id, 3, "url.found", { url_id: "u2", host: "example[.]com" }),
    ]);
    expect(r).toMatchObject({ status: 200, body: { ok: true, stored: 3, rejected: 0, ignored: 0 } });
    const rows = await traceRows(id);
    expect(rows.map((x) => [x.seq, x.kind, x.stage])).toEqual([
      [1, "search.request", "collect"],
      [2, "url.found", "collect"],
      [3, "url.found", "collect"],
    ]);
    expect(rows[1]!.data).toEqual({ url_id: "u1", host: "lockbit3…xyz7[.]onion", engine: "ahmia", depth: 0 });
    expect((await runRow(id))!.status).toBe("running");
    // traces are not progress: the snapshot's counts and stages come from progress events only
    expect((await getInvestigation((await runRow(id))!.userId, id))!.counts).toBeNull();
  });

  it("ignores unknown kinds, rejects oversized or malformed events, and stores the rest of the batch", async () => {
    const { id } = await newRun();
    const r = await postBatch(id, [
      tr(id, 1, "url.found", { url_id: "u1", host: "example[.]com" }),
      tr(id, 2, "page.screenshot", { url_id: "u1" }), // unknown: ignored
      tr(id, 3, "query.refined", { index: 0, text: "x".repeat(500) }), // oversized: rejected
      tr(id, 4, "url.found", { url_id: "u2", host: "https://example.com/a" }), // a URL: rejected
      tr(id, 5, "url.kept", { url_id: "u1", score: 0.7 }),
    ]);
    expect(r.body).toMatchObject({ stored: 2, ignored: 1, rejected: 2 });
    expect((await traceRows(id)).map((x) => x.seq)).toEqual([1, 5]);
  });

  it("rejects a batch whose signed seq is not its last event, or whose seqs go backwards", async () => {
    const { id } = await newRun();
    const a = [tr(id, 1, "url.kept", { url_id: "u1" }), tr(id, 2, "url.kept", { url_id: "u2" })];
    expect((await postBatch(id, a, { headerSeq: 1 })).status).toBe(400);
    expect((await postBatch(id, [a[1], a[0]])).status).toBe(400);
    expect(
      (await postBatch(id, [tr("00000000-0000-4000-8000-000000000000", 1, "url.kept", { url_id: "u1" })], {}))
        .status,
    ).toBe(400);
    expect(await traceRows(id)).toEqual([]);
  });

  it("deduplicates a retried batch on (run_id, seq)", async () => {
    const { id } = await newRun();
    const b = [tr(id, 1, "url.found", { url_id: "u1", host: "example[.]com" })];
    await postBatch(id, b);
    expect((await postBatch(id, b)).body).toMatchObject({ stored: 0, duplicate: 1 });
    expect(await traceRows(id)).toHaveLength(1);
  });

  it("caps traces per kind per run (url.found 600)", async () => {
    const { id } = await newRun();
    let seq = 0;
    for (let b = 0; b < 13; b++) {
      const events = Array.from({ length: 50 }, () => {
        seq++;
        return tr(id, seq, "url.found", { url_id: `u${seq}`, host: `h${seq}.example[.]com` });
      });
      await postBatch(id, events);
    }
    const rows = await traceRows(id);
    expect(rows).toHaveLength(TRACE_CAPS["url.found"]);
    // other kinds still have room
    const r = await postBatch(id, [tr(id, seq + 1, "url.kept", { url_id: "u1" })]);
    expect(r.body).toMatchObject({ stored: 1, capped: 0 });
  });

  it("applyCaps holds the total per run as well as each kind", () => {
    const ev = (kind: TraceEvent["kind"]) => ({ kind }) as TraceEvent;
    const existing = {
      "url.found": 600,
      "url.kept": 600,
      "url.dropped": 600,
      "page.fetched": 400,
      "entity.found": 300,
    };
    const used = Object.values(existing).reduce((a, n) => a + n, 0); // 2500
    const many = Array.from({ length: 800 }, (_, i) => ev(i % 2 ? "search.request" : "search.result"));
    const { keep, capped } = applyCaps(many, existing);
    expect(keep).toHaveLength(Math.min(TRACE_TOTAL_CAP - used, 400));
    expect(capped).toBe(800 - keep.length);
    expect(applyCaps([ev("url.found")], existing)).toEqual({ keep: [], capped: 1 });
  });

  it("a safety drop removes the host from the URL's stored url.found, and the stream never shows it", async () => {
    const { id } = await newRun();
    await postBatch(id, [
      tr(id, 1, "url.found", { url_id: "u1", host: "badplace…abcd[.]onion", engine: "torch", depth: 1 }),
      tr(id, 2, "url.found", { url_id: "u2", host: "fine…wxyz[.]onion", engine: "torch" }),
      tr(id, 3, "url.kept", { url_id: "u2" }),
    ]);
    await postBatch(id, [
      tr(id, 4, "url.dropped", { url_id: "u1", reason: "safety" }, "filter"),
      tr(
        id,
        5,
        "page.fetched",
        { url_id: "u2", outcome: "safety_dropped", http_status: 200, bytes: 99 },
        "fetch",
      ),
    ]);
    const rows = await traceRows(id);
    expect(rows.find((r) => r.seq === 1)!.data).toEqual({ url_id: "u1" });
    expect(rows.find((r) => r.seq === 2)!.data).toEqual({ url_id: "u2" });
    expect(rows.find((r) => r.seq === 5)!.data).toEqual({ url_id: "u2", outcome: "safety_dropped" });
    await postEvent(id, 6, { type: "failed", reason: "error" });
    const out = await readSse(id);
    expect(out).not.toContain("badplace");
    expect(out).not.toContain("[.]onion");
  });

  it("traces after the run ended are ignored", async () => {
    const { id } = await newRun();
    await postEvent(id, 1, { type: "failed", reason: "error" });
    const r = await postBatch(id, [tr(id, 2, "url.found", { url_id: "u1", host: "example[.]com" })]);
    expect(r.body).toMatchObject({ result: "ignored" });
    expect(await traceRows(id)).toEqual([]);
  });
});

describe("P8-3: trace SSE frames, resume and the live marker", () => {
  it("streams traces as `event: trace` in seq order with progress, marks `live` once, and resumes from Last-Event-ID", async () => {
    const { id } = await newRun();
    await postEvent(id, 1, { type: "stage", stage: "collect", status: "start" });
    await postBatch(id, [
      tr(id, 2, "url.found", { url_id: "u1", host: "a…bcde[.]onion", engine: "ahmia" }),
      tr(id, 3, "url.found", { url_id: "u2", host: "example[.]com", engine: "torch" }),
    ]);
    await postEvent(id, 4, { type: "stage", stage: "collect", status: "end" });
    await postBatch(id, [tr(id, 5, "url.dropped", { url_id: "u2", reason: "duplicate" }, "filter")]);
    await postEvent(id, 6, { type: "failed", reason: "error" });

    const all = await readSse(id);
    const ids = [...all.matchAll(/^id: (\d+)\nevent: (\w+)/gm)].map((m) => [Number(m[1]), m[2]]);
    expect(ids).toEqual([
      [1, "progress"],
      [2, "trace"],
      [3, "trace"],
      [4, "progress"],
      [5, "trace"],
      [6, "progress"],
    ]);
    expect(all.match(/event: live\n/g)).toHaveLength(1);
    const trace = JSON.parse(/event: trace\ndata: (.*)\n/.exec(all)![1]!);
    expect(trace).toMatchObject({ seq: 2, stage: "collect", kind: "url.found", data: { url_id: "u1" } });

    const resumed = await readSse(id, "3");
    const rids = [...resumed.matchAll(/^id: (\d+)/gm)].map((m) => Number(m[1]));
    expect(rids).toEqual([4, 5, 6]);
    expect(resumed).toContain("event: live");
  });
});

describe("P8-3: traces are the run owner's only (RLS)", () => {
  it("another user gets nothing: not the rows, not the stream, not the replay", async () => {
    const { u, id } = await newRun("private trace");
    await postBatch(id, [tr(id, 1, "url.found", { url_id: "u1", host: "secret…host[.]onion" })]);
    await postEvent(id, 2, { type: "failed", reason: "error" });

    const other = await makeUser();
    const seen = await db().withUser(other.id, (tx) =>
      tx.select().from(runEvents).where(eq(runEvents.runId, id)),
    );
    expect(seen).toEqual([]);
    const own = await db().withUser(u.id, (tx) => tx.select().from(runEvents).where(eq(runEvents.runId, id)));
    expect(own.filter((r) => r.type === "trace")).toHaveLength(1);

    asUser(other);
    const sse = await sseRoute.GET(new Request(`${APP}/api/investigations/${id}/events`), ctxFor(id));
    expect(sse.status).toBe(404);
    const rep = await replayRoute.GET(new Request(`${APP}/api/investigations/${id}/replay`), ctxFor(id));
    expect(rep.status).toBe(404);

    asUser(u);
    const mine = await replayRoute.GET(new Request(`${APP}/api/investigations/${id}/replay`), ctxFor(id));
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as { status: string; events: { type: string; kind?: string }[] };
    expect(body.status).toBe("failed");
    expect(body.events.map((e) => e.kind ?? e.type)).toEqual(["url.found", "failed"]);
  });

  it("replay is only for finished runs", async () => {
    const { id } = await newRun();
    const r = await replayRoute.GET(new Request(`${APP}/api/investigations/${id}/replay`), ctxFor(id));
    expect(r.status).toBe(404);
  });
});
