import { describe, expect, it } from "vitest";
import { ProgressEvent, TRACE_BATCH_MAX, TraceBatch, checkTrace, displayHost, isSafetyDrop } from "./index";

const at = "2026-10-17T10:00:00.000Z";
const tr = (kind: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "trace",
  schema: 2,
  run_id: "r1",
  seq: 7,
  at,
  stage: "collect",
  kind,
  data,
  ...extra,
});

describe("contract v2 trace validation", () => {
  it("accepts every kind with its required fields", () => {
    const ok = [
      tr("query.refined", { index: 0, text: "LockBit leak site" }),
      tr("search.request", { engine: "ahmia", query_index: 0 }),
      tr("search.result", { engine: "ahmia", query_index: 0, status: "timeout", results: 0, ms: 9000 }),
      tr("url.found", { url_id: "u17", host: "lockbit3…xyz7[.]onion", engine: "ahmia", depth: 0 }),
      tr("url.found", { url_id: "u18", host: "example[.]com" }),
      tr("url.kept", { url_id: "u17", score: 0.82 }),
      tr("url.dropped", { url_id: "u18", reason: "duplicate" }),
      tr("page.fetched", {
        url_id: "u17",
        outcome: "http_404",
        http_status: 404,
        bytes: 2_000_000,
        ms: 1200,
      }),
      tr("page.entities", { url_id: "u17", by_type: { CVE: 3, ONION_URL: 5 } }),
      tr("entity.found", {
        entity_id: "e204",
        type: "EMAIL",
        display: "j***@acme[.]com",
        confidence: 0.9,
        url_id: "u17",
      }),
      tr("enrich.source", { source: "rdap", status: "no_key" }),
      tr("graph.progress", { nodes: 10, edges: 4, communities: 2 }),
      tr("summary.status", { kind: "llm", attempt: 1 }),
      tr("trace.truncated", { kind: "url.found", dropped: 40 }),
    ];
    for (const e of ok) expect(checkTrace(e), JSON.stringify(e)).toMatchObject({ ok: true });
  });

  it("ignores kinds it doesn't know yet (a newer engine) without rejecting", () => {
    expect(checkTrace(tr("page.screenshot", { url_id: "u1" }))).toEqual({ ok: false, ignored: true, seq: 7 });
  });

  it("rejects oversized and malformed fields", () => {
    const bad = [
      tr("query.refined", { index: 0, text: "x".repeat(201) }),
      tr("entity.found", { entity_id: "e1", type: "CVE", display: "y".repeat(81) }),
      tr("url.found", { url_id: "u1", host: "http://example.com/path?q=1" }), // a URL, not a display host
      tr("url.found", { url_id: "u1", host: "example.com" }), // not defanged
      tr("url.found", { url_id: "u1", host: "example[.]com/admin" }), // a path
      tr("url.found", { url_id: "17", host: "example[.]com" }), // bad id
      tr("url.dropped", { url_id: "u1", reason: "boring" }),
      tr("page.fetched", { url_id: "u1", outcome: "ok", bytes: 2e9 }),
      tr("entity.found", { entity_id: "e1", type: "EMAIL", display: "john.doe@acme.com" }), // clear email
      tr("entity.found", { entity_id: "e1", type: "URL", display: "https://acme.com/login" }),
      tr("entity.found", { entity_id: "e1", type: "X", display: "<img src=x>" }),
      tr("page.entities", {
        url_id: "u1",
        by_type: Object.fromEntries([...Array(41)].map((_, i) => [`T${i}`, 1])),
      }),
      tr("url.kept", { url_id: "u1" }, { stage: "nowhere" }),
      tr("url.kept", { url_id: "u1" }, { schema: 1 }),
      { ...tr("url.kept", { url_id: "u1" }), at: "yesterday" },
    ];
    for (const e of bad)
      expect(checkTrace(e), JSON.stringify(e)).toMatchObject({ ok: false, ignored: false });
  });

  it("strips a safety drop down to its id and reason", () => {
    const r = checkTrace(
      tr("page.fetched", { url_id: "u3", outcome: "safety_dropped", http_status: 200, bytes: 5 }),
    );
    expect(r.ok && r.event.data).toEqual({ url_id: "u3", outcome: "safety_dropped" });
    expect(r.ok && isSafetyDrop(r.event)).toBe(true);
    expect(isSafetyDrop({ kind: "url.dropped", data: { url_id: "u3", reason: "safety" } } as never)).toBe(
      true,
    );
    expect(isSafetyDrop({ kind: "url.dropped", data: { url_id: "u3", reason: "duplicate" } } as never)).toBe(
      false,
    );
  });

  it("batches carry 1..50 events", () => {
    expect(TraceBatch.safeParse({ schema: 2, run_id: "r1", events: [] }).success).toBe(false);
    expect(
      TraceBatch.safeParse({ schema: 2, run_id: "r1", events: Array(TRACE_BATCH_MAX).fill({}) }).success,
    ).toBe(true);
    expect(
      TraceBatch.safeParse({ schema: 2, run_id: "r1", events: Array(TRACE_BATCH_MAX + 1).fill({}) }).success,
    ).toBe(false);
  });

  it("schema-1 progress events accept the v2 `schema` stamp", () => {
    const e = { run_id: "r1", seq: 1, at, type: "stage", stage: "refine", stage_total: 8, schema: 2 };
    expect(ProgressEvent.safeParse(e).success).toBe(true);
  });

  it("display hosts follow the contract", () => {
    expect(displayHost("http://lockbit3abcdefghijklmnopqrstuvwxyz234567abcdefghxyz7.onion/path?q=1")).toBe(
      "lockbit3…xyz7[.]onion",
    );
    expect(displayHost("https://www.example.com/a/b")).toBe("www.example[.]com");
    expect(displayHost("not a host")).toBeNull();
  });
});
