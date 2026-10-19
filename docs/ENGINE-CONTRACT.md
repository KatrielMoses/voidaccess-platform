# Engine contract: `voidaccess job run` (cloud job mode)

**Status:** v0.3, 2026-10-12 (§2–3 reconciled with P0's engine-client). Draft v0.2 was 2026-10-11. Implemented by engine phase E4 (see ROADMAP.md) and mirrored by `packages/engine-mock` so the platform can be built in parallel. The canonical TypeScript types will live in `packages/engine-client/src/types.ts`.

## 1. Invocation

One container runs one investigation. Cloud Run Jobs starts it with:

```
voidaccess job run --spec-url "$RUN_SPEC_URL"
```

- `RUN_SPEC_URL` is a short-lived, single-use URL on the platform (`GET /api/engine/runs/{run_id}/spec?t=<token>`) that returns the `RunSpec`.
- The query is **not** passed as an argument or environment variable. That keeps user queries out of Cloud Run execution metadata.
- Secrets come from the environment: `OPENROUTER_API_KEY`, enrichment keys and `VA_CLOUD_POLICY=1`.

```ts
type RunSpec = {
  run_id: string;
  query: string;
  depth: "quick" | "standard" | "deep";
  callback_url: string;          // POST ProgressEvent / completion here
  callback_secret: string;       // per-run HMAC key
  artifact_put_urls: {           // presigned PUT URLs (R2/GCS), one per artifact
    bundle: string;              // bundle.json
    exports: Record<"stix" | "misp" | "sigma" | "yara" | "snort" | "suricata", string>;
  };
  deadline_at: string;           // ISO. The job must finish and emit `failed` with reason "deadline" by then
};
```

## 2. Callbacks (job → platform)

- `POST callback_url`, JSON body `ProgressEvent`
- Headers: `X-VA-Run: <run_id>`, `X-VA-Seq: <n>`, `X-VA-Timestamp: <unix seconds>`, `X-VA-Signature: sha256=<hex HMAC-SHA256(callback_secret, "<X-VA-Timestamp>.<raw body>")>`. The verifier rejects more than 300 s of skew. Implemented in `packages/engine-client`.
- Retries use exponential backoff (via `pacing`). The platform deduplicates on `(run_id, seq)`.
- The pipeline must never block on a slow callback. Use a bounded queue and drop intermediate `counts` events if the buffer fills; `stage` and terminal events are never dropped.

```ts
// Execution order: the engine runs extract BEFORE enrich. Canonical list: STAGES in @voidaccess/config.
type Stage = "refine" | "collect" | "filter" | "fetch" | "extract" | "enrich" | "graph" | "summarize";

type ProgressEvent = {
  run_id: string; seq: number; at: string;
  type: "stage" | "counts" | "refined" | "completed" | "failed" | "cancelled";
  stage?: Stage; stage_index?: number /* 1-based, 1..8 */; stage_total: 8;
  status?: "started" | "completed"; duration_ms?: number;   // optional per-stage timing
  refined_queries?: string[];                       // on type "refined", shown in the UI
  counts?: { sources_queried: number; results_found: number; pages_fetched: number; entities_found: number; actors_found: number };
  message?: string;                                 // human label; never raw dark-web text
  stages_completed?: Stage[];                       // on failed/cancelled → partial refund
  reason?: "blocked_query" | "no_results" | "deadline" | "error" | "cancelled" | "sources_unreachable";
  metrics?: RunMetrics;                             // on terminal events
};
```

**Cancellation:**
- The platform cancels a run by cancelling the Cloud Run execution, which sends SIGTERM and then SIGKILL after a grace period.
- The job traps SIGTERM, stops at the next checkpoint, emits `cancelled` with `stages_completed`, and exits.
- Checkpoints come between every stage and inside the collect, fetch and enrich loops.

### 2.1 Contract v2: trace events (P8 / E3)

Opt-in (`VOIDACCESS_TRACE_EVENTS=1` or CLI `--trace`; the cloud runner turns it on). Every event gains `schema: 2`;
one event type is added: `{ type: "trace", schema: 2, run_id, seq, at, stage, kind, data }`. The kinds, their bounded
fields, the host display form, the safety rule and the per-run caps (url.found 600, url.kept/dropped 600 each,
page.fetched 400, entity.found 300, others 200; total 3000) are defined once in
`packages/engine-client/src/trace.ts` (mirrored for the runner in `runner/cloud/trace.py`).

- **Batches.** Trace events are POSTed to the same callback URL as `{ schema: 2, run_id, events: [...] }`, 1..50
  events, signed like a single event with `X-VA-Seq` = the seq of the **last** event. Batches carry traces only; a
  pending batch is flushed before any non-trace event, after 300 ms, or at 50 events, so delivery order is seq order.
- **Backpressure.** Traces are dropped first (before they get a seq), then a queued trace batch is evicted to make
  room for `counts`; stage, refined and terminal events are never dropped. Consumers tolerate seq gaps.
- **Platform.** Each event is validated on its own: unknown kinds are ignored, malformed or oversized ones rejected,
  the rest stored in `run_events` (type `trace`, `kind`, `data`). A safety drop also strips the host from the URL's
  stored `url.found`. Traces never settle a run and are ignored once it is ingesting or terminal. The SSE stream
  sends them as `event: trace` and marks the end of the backlog with one `event: live`.
- **What the engine actually sends** (checked against a real Tor run, 490 traces, all accepted):
  - search engine and enrichment names are the engine's own ("Ahmia (Clearnet Proxy)"), so they allow spaces and
    brackets; type names and `by_type` keys stay `[A-Za-z0-9_.-]`;
  - an onion or clearnet name that contains an abuse term is masked with `*` ("********…fcid[.]onion");
  - `page.fetched.outcome` also has `error` (a connection failure that fits no other value); `too_large` is not sent;
  - a page reported `ok` can be followed by `safety_dropped` from the post-scrape safety gate; the safety drop wins
    and the page moves to the safety tray with its host removed. No other outcome overrides an earlier one;
  - successful fetches arrive in a burst after the scrape batch's safety scan, failures arrive as they happen;
  - `trace.truncated` is sent once per kind just before the terminal event, with the final dropped count;
  - `query.refined` can also arrive in `collect`, and entities found by enrichment have no `url_id`.

## 3. Result bundle (`bundle.json`, uploaded before the `completed` event)

```ts
type ResultBundle = {
  schema_version: 1;
  run_id: string; query: string; refined_queries: string[]; depth: Depth;
  started_at: string; completed_at: string; engine_version: string;
  summary: { markdown: string; key_findings: string[]; risk_notes: string[]; confidence: "low" | "medium" | "high"; source_count: number };
  entities: Array<{ id: string; type: EntityType; value: string; display_value: string; sensitive: boolean;
                    confidence: number; first_seen?: string; source_ids: string[]; tags: string[] }>;
  relationships: Array<{ source: string; target: string; type: string; weight: number; evidence_source_ids: string[] }>;
  actors: Array<{ id: string; handle: string; aliases: string[]; entity_ids: string[]; first_seen?: string; last_seen?: string; summary?: string }>;
  communities: Array<{ id: number; entity_ids: string[]; label?: string }>;
  sources: Array<{ id: string; kind: "tor_search" | "onion_page" | "paste" | "code_forge" | "feed" | "enrichment";
                   name: string; url: string | null; fetched_at: string; excerpt: string /* ≤ 500 chars, sanitized */ }>;
  metrics: RunMetrics;
};

type RunMetrics = {
  duration_ms: number; tor_bootstrap_ms: number;
  stage_ms: Partial<Record<Stage, number>>;
  llm_calls: number; llm_tokens_in: number; llm_tokens_out: number; llm_cost_usd: number;  // from OpenRouter `usage`
  pages_fetched: number; bytes_fetched: number; enrichment_calls: Record<string, number>;
};
```

`EntityType` uses the engine's own UPPER_SNAKE names (e.g. `RANSOMWARE_GROUP`, `ONION_URL`, `THREAT_ACTOR_HANDLE`, `ORGANIZATION_NAME`, `CVE`), not lowercase categories. The canonical schema is in `packages/engine-client` (zod + `schemas/*.json`). `at` may be a Python `isoformat()` string with an offset.

## 4. Cloud policy (`VA_CLOUD_POLICY=1`): guarantees the job must enforce

| # | Guarantee |
|---|---|
| G1 | Content-safety gates (query, URL, content, entity) are **always on**. No env var or flag can disable them. A URL-gate error **fails closed**. |
| G2 | The Layer-4 content scan runs **before** any page is written anywhere (SQLite, bundle, excerpts). |
| G3 | Text content types only. No image or media URLs anywhere in the bundle; the urlscan `screenshot_url` is stripped. |
| G4 | Entities marked `sensitive` cover credentials, tokens, keys, emails, phones and personal names. Raw passwords and secrets are **never** included. `value` for a secret is `len:N sha256:<8-hex prefix>`. `display_value` is pre-masked (`j***@acme.com`). |
| G5 | `SAFETY_BYPASS_PROMPT` is not used (pending decision D3). |
| G6 | `PRIVATE_MODE` is on: no shared-corpus reads or writes, no Meilisearch, no Chroma, no ingest (pending decision D2). |
| G7 | The run is fully self-contained: a fresh SQLite DB in the container, and no network calls except Tor, the listed clearnet sources, OpenRouter, the callback URL and the artifact URLs. |
| G8 | Depth presets follow ROADMAP E2. LLM usage and cost are recorded per call. |
| G9 | A blocked query emits `failed` with reason `blocked_query` **before** any collection starts, so the platform refunds in full and logs it for abuse review. |
| G10 | Exit code 0 on completed, cancelled, no_results or sources_unreachable (Tor never bootstrapped, or most onion search engines failed and no onion page had content: the run stops before further LLM spend); non-zero only on a crash. The platform treats a crash without a terminal event as `failed` (watchdog). |
