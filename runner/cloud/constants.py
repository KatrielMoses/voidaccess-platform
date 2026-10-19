"""Named limits for the production runner (no bare magic numbers at call sites).

Where a number comes from is stated next to it; E0/E1B figures are in docs/baseline/.
"""

from __future__ import annotations

# --- bounded cost (guarantee 6) -------------------------------------------------------------------

# Wall-clock cap per depth, measured from process start. E1B (cloud profile, 1 vCPU) p90 / max:
# quick 245 / 262 s, standard 283 / 334 s, deep 261 / 336 s; the only outlier was an 862 s run before
# VOIDACCESS_LLM_CHUNK_TIMEOUT existed. The caps are about 1.8x the worst measured run for quick and
# standard (8 and 10 minutes, set by the brief); deep is not launched at v1 so it gets 13 minutes,
# which still leaves a margin under the 15-minute Cloud Run task timeout.
WALL_CLOCK_CAP_S = {"quick": 8 * 60, "standard": 10 * 60, "deep": 13 * 60}

# Time kept at the end of the cap for the bundle build, the exports and the uploads (a 60-page run
# builds in about 2 s and uploads a few MB). The engine itself is cancelled at cap - this reserve.
FINALIZE_RESERVE_S = 75

# Per-run LLM token budget (prompt + completion), enforced by the usage wrapper. Twice the highest total
# observed in E1B for the depth (quick max 34,078 and p90 20,911; standard max 71,003 and p90 60,815;
# deep max 103,949 and p90 89,513), so a normal run never trips it. At deepseek-chat list price the
# standard budget is about $0.06. When spent, every later LLM call raises and the engine falls back to
# its non-LLM paths and the fallback summary.
LLM_TOKEN_BUDGET = {"quick": 70_000, "standard": 140_000, "deep": 210_000}

# --- unreachable sources (G5, R2b-5) ---------------------------------------------------------------------

# A run ends `failed: sources_unreachable` (full refund) when Tor never bootstrapped, or when at least this share of
# the onion search engines it asked never answered (timeout, error, cut by the search deadline) AND no onion page with
# content was fetched (no onion URL at all, already at the end of collect). R2b evidence: the two bad runs had 9/12
# and 10/12 engines timed out with 0 onion pages; the last three good production runs had 0, 0 and 5 of ~12.
UNREACHABLE_ENGINE_FAIL_RATIO = 0.75
UNREACHABLE_MESSAGE = "dark-web sources unreachable"

# --- signals ---------------------------------------------------------------------------------------

# Cloud Run sends SIGTERM and then SIGKILL after 10 s on `executions.cancel`. Waiting for the next
# stage boundary can take 30+ s, so a cancel interrupts the engine at its next await and the grace
# period is spent emitting `cancelled`.
CANCEL_FLUSH_TIMEOUT_S = 6.0

# --- Tor -------------------------------------------------------------------------------------------

TOR_START_JITTER_MAX_S = 5.0          # random start delay against bursts (E1B: ~3% bootstrap failures at 50)
TOR_BOOTSTRAP_ATTEMPTS = 3            # the first try and two retries
TOR_BOOTSTRAP_TIMEOUT_S = 60.0        # per attempt; measured p50 3-6 s, p90 3-19 s, rare tail to 160 s
TOR_STOP_GRACE_S = 5.0

# --- callbacks -------------------------------------------------------------------------------------

EVENT_QUEUE_MAX = 256                 # beyond this a `counts` event evicts the oldest trace batch, else is dropped
EVENT_RETRY_BASE_S = 0.5
EVENT_RETRY_MAX_DELAY_S = 10.0
EVENT_RETRY_BUDGET_S = 120.0          # per event; a 5xx or network error is retried until this is spent
TERMINAL_RETRY_BUDGET_S = 240.0
EVENT_HTTP_TIMEOUT_S = 10.0
EVENT_FLUSH_TIMEOUT_S = 30.0          # wait for the queue to drain before the terminal event

# Contract v2 trace events are posted in batches (`{schema: 2, run_id, events: [...]}`). They are best effort: a
# slow or failing app must never hold back the engine or the stage/terminal events, so they have their own bounds.
TRACE_BATCH_MAX_EVENTS = 50           # a batch is sent when it holds this many events (the app accepts up to 100)
TRACE_BATCH_MAX_WAIT_S = 0.3          # ... or this long after its first event, whichever comes first
TRACE_QUEUE_MAX_EVENTS = 1000         # trace events waiting to be sent; new traces are dropped (no seq) beyond this
TRACE_RETRY_BUDGET_S = 5.0            # per batch; a batch that cannot be delivered in time is abandoned (a seq gap)

# --- bundle ----------------------------------------------------------------------------------------

EXCERPT_MAX_CHARS = 500               # contract: sanitized, at most 500 chars
MAX_BUNDLE_ENTITIES = 50_000          # packages/ingest MAX_ENTITIES: ingest rejects more

# --- uploads ---------------------------------------------------------------------------------------

UPLOAD_ATTEMPTS = 4
UPLOAD_HTTP_TIMEOUT_S = 60.0
ALLOWED_GCS_BUCKET = "voidaccess-cloud-runs"
