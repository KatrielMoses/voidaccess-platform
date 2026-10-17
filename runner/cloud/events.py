"""Signed, retrying, non-blocking delivery of progress events to the app.

Guarantee 4: each callback is HMAC-signed over "<timestamp>.<raw body>", carries a strictly increasing
`seq`, and is retried with backoff on a 5xx or a network error. A slow app never blocks the pipeline:
the engine's sink only enqueues, and one worker thread delivers in order. Exactly one terminal event is
ever sent per run.

Contract v2: every event carries `schema: 2`. Schema-1 events (stage, counts, refined, terminal) are posted one
by one as before. `trace` events are posted in batches `{"schema": 2, "run_id", "events": [...]}` signed like a
single event with X-VA-Seq = the seq of the last event in the batch. A pending batch is sealed when it reaches
TRACE_BATCH_MAX_EVENTS, TRACE_BATCH_MAX_WAIT_S after its first event, right before any schema-1 event is
enqueued (so delivery order is seq order), and on flush()/close().

What may be lost, and how:
  * a trace beyond TRACE_QUEUE_MAX_EVENTS queued traces is dropped before it gets a seq (no gap);
  * a `counts` event arriving at a full queue first evicts the oldest queued trace batch (its seqs become a
    gap, which consumers tolerate); only when no batch can be evicted is the counts event dropped, before it
    gets a seq;
  * a trace batch has a short retry budget (TRACE_RETRY_BUDGET_S) and is abandoned when it is spent (a gap);
  * stage, refined and terminal events are never dropped.
"""

from __future__ import annotations

import json
import random
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

import httpx

from . import constants as C
from .identity import TokenSource, audience_for
from .scrub import MIN_SECRET_LEN, REDACTED
from .signing import sign_callback
from .trace import TRACE_SCHEMA, sanitize_trace

TERMINAL_TYPES = ("completed", "failed", "cancelled")
# Contract fields the app's ProgressEvent schema accepts; anything else is dropped before sending.
_ALLOWED_FIELDS = (
    "type",
    "schema",
    "stage",
    "stage_index",
    "stage_total",
    "status",
    "duration_ms",
    "refined_queries",
    "counts",
    "message",
    "stages_completed",
    "reason",
    "metrics",
    "at",
)
_MESSAGE_MAX = 300
# Statuses that mean "try again": the app is busy or down (5xx), or the request was throttled.
_RETRY_STATUSES = frozenset({408, 425, 429})


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class _Item:
    """One POST: a single schema-1 event, or a batch of `n` trace events (seq = the last event's seq)."""

    __slots__ = ("seq", "body", "terminal", "batch", "n")

    def __init__(self, seq: int, body: bytes, *, terminal: bool = False, batch: bool = False, n: int = 1):
        self.seq, self.body, self.terminal, self.batch, self.n = seq, body, terminal, batch, n


class EventSender:
    def __init__(
        self,
        callback_url: str,
        secret: str,
        run_id: str,
        tokens: TokenSource | None = None,
        client: httpx.Client | None = None,
        queue_max: int = C.EVENT_QUEUE_MAX,
        retry_budget_s: float = C.EVENT_RETRY_BUDGET_S,
        terminal_retry_budget_s: float = C.TERMINAL_RETRY_BUDGET_S,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        trace_batch_max: int = C.TRACE_BATCH_MAX_EVENTS,
        trace_batch_wait_s: float = C.TRACE_BATCH_MAX_WAIT_S,
        trace_queue_max: int = C.TRACE_QUEUE_MAX_EVENTS,
        trace_retry_budget_s: float = C.TRACE_RETRY_BUDGET_S,
        redact: Iterable[str | None] = (),
    ):
        self.callback_url = callback_url
        self._secret = secret
        self.run_id = run_id
        self._tokens = tokens
        self._client = client or httpx.Client(timeout=C.EVENT_HTTP_TIMEOUT_S)
        self._audience = audience_for(callback_url)
        self._queue_max = queue_max
        self._retry_budget = retry_budget_s
        self._terminal_budget = terminal_retry_budget_s
        self._sleep = sleep
        self._clock = clock
        self._trace_batch_max = max(1, trace_batch_max)
        self._trace_wait = trace_batch_wait_s
        self._trace_queue_max = trace_queue_max
        self._trace_budget = trace_retry_budget_s
        # Trace strings come from page content and engine internals: credentials of ours must never ride along.
        # (The user's query is deliberately not here: refined queries and entity names may legitimately quote it.)
        secrets = sorted({s for s in [secret, *redact] if s and len(s) >= MIN_SECRET_LEN}, key=len, reverse=True)
        self._redact_re = re.compile("|".join(re.escape(s) for s in secrets)) if secrets else None

        self._cv = threading.Condition()
        self._buf: deque[_Item] = deque()
        self._pending: list[dict[str, Any]] = []  # trace payloads (seq stamped) not yet sealed into a batch
        self._pending_since = 0.0
        self._queued_traces = 0  # pending + in queued batches (not the one in flight)
        self._seq = 0
        self._terminal_enqueued = False
        self._terminal_delivered = False
        self._closed = False
        self._inflight = False
        self.sent = 0
        self.dropped_counts = 0
        self.failed = 0
        self.last_seq_sent = 0
        self.traces_sent = 0
        self.trace_batches_sent = 0
        self.dropped_traces = 0  # refused at emit (bound hit or failed sanitizing): never got a seq
        self.evicted_traces = 0  # evicted from the queue to make room for a counts event: a seq gap
        self.failed_traces = 0  # in a batch that was abandoned: a seq gap
        self._worker = threading.Thread(target=self._drain, name="va-events", daemon=True)
        self._worker.start()

    # -- producing -----------------------------------------------------------------------------------

    def _redact(self, text: str) -> str:
        pattern = self._redact_re
        return pattern.sub(REDACTED, text) if pattern else text

    def emit(self, event: dict[str, Any]) -> bool:
        """Stamp, serialize and enqueue `event`. Never blocks and never raises. False if not enqueued."""
        try:
            if event.get("type") == "trace":
                return self._emit_trace(event)
            etype = event.get("type")
            terminal = etype in TERMINAL_TYPES
            payload = {k: event[k] for k in _ALLOWED_FIELDS if event.get(k) is not None}
            payload["schema"] = TRACE_SCHEMA
            payload["stage_total"] = 8
            payload["run_id"] = self.run_id
            payload.setdefault("at", utc_now_iso())
            if isinstance(payload.get("message"), str):
                payload["message"] = payload["message"][:_MESSAGE_MAX]
            with self._cv:
                if self._closed or self._terminal_enqueued:
                    return False
                self._seal_locked()  # traces emitted before this event go out before it
                if etype == "counts" and len(self._buf) >= self._queue_max and not self._evict_oldest_batch_locked():
                    self.dropped_counts += 1
                    return False
                self._seq += 1
                payload["seq"] = self._seq
                body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
                if terminal:
                    self._terminal_enqueued = True
                self._buf.append(_Item(self._seq, body, terminal=terminal))
                self._cv.notify_all()
            return True
        except Exception:
            return False

    def _emit_trace(self, event: dict[str, Any]) -> bool:
        payload = sanitize_trace(event, self._redact)
        if payload is None:
            with self._cv:
                self.dropped_traces += 1
            return False
        payload["run_id"] = self.run_id
        payload.setdefault("at", utc_now_iso())
        with self._cv:
            if self._closed or self._terminal_enqueued:
                return False
            if self._queued_traces >= self._trace_queue_max:
                self.dropped_traces += 1
                return False
            self._seq += 1
            payload["seq"] = self._seq
            if not self._pending:
                self._pending_since = self._clock()
            self._pending.append(payload)
            self._queued_traces += 1
            if len(self._pending) >= self._trace_batch_max:
                self._seal_locked()
            self._cv.notify_all()
        return True

    def _seal_locked(self) -> None:
        """Turn the pending traces into one queued batch. Caller holds the lock."""
        if not self._pending:
            return
        events, self._pending = self._pending, []
        envelope = {"schema": TRACE_SCHEMA, "run_id": self.run_id, "events": events}
        body = json.dumps(envelope, separators=(",", ":"), default=str).encode("utf-8")
        self._buf.append(_Item(events[-1]["seq"], body, batch=True, n=len(events)))
        self._cv.notify_all()

    def _evict_oldest_batch_locked(self) -> bool:
        for i, item in enumerate(self._buf):
            if item.batch:
                del self._buf[i]
                self._queued_traces -= item.n
                self.evicted_traces += item.n
                return True
        return False

    @property
    def terminal_enqueued(self) -> bool:
        return self._terminal_enqueued

    @property
    def terminal_delivered(self) -> bool:
        return self._terminal_delivered

    # -- consuming -----------------------------------------------------------------------------------

    def _next_item(self) -> _Item | None:
        """Block until there is something to send (sealing a pending batch when its time is up). None = stop."""
        with self._cv:
            while True:
                if self._pending and (self._closed or self._clock() - self._pending_since >= self._trace_wait):
                    self._seal_locked()
                if self._buf:
                    item = self._buf.popleft()
                    if item.batch:
                        self._queued_traces -= item.n
                    self._inflight = True
                    return item
                if self._closed:
                    return None
                if self._pending:
                    remaining = self._pending_since + self._trace_wait - self._clock()
                    self._cv.wait(min(max(remaining, 0.001), self._trace_wait))
                else:
                    self._cv.wait()

    def _drain(self) -> None:
        while True:
            item = self._next_item()
            if item is None:
                return
            if item.batch:
                budget = self._trace_budget
            else:
                budget = self._terminal_budget if item.terminal else self._retry_budget
            ok = False
            try:
                ok = self._deliver(item.seq, item.body, budget)
            except Exception:
                ok = False
            with self._cv:
                self._inflight = False
                if ok:
                    self.last_seq_sent = item.seq
                    if item.batch:
                        self.traces_sent += item.n
                        self.trace_batches_sent += 1
                    else:
                        self.sent += 1
                        if item.terminal:
                            self._terminal_delivered = True
                elif item.batch:
                    self.failed_traces += item.n
                else:
                    self.failed += 1
                self._cv.notify_all()

    def _headers(self, seq: int, body: bytes, *, force_token: bool = False) -> dict[str, str]:
        headers = sign_callback(self._secret, self.run_id, seq, body)
        headers["Content-Type"] = "application/json"
        if self._tokens is not None:
            token = self._tokens.id_token(self._audience, force=force_token)
            if token:
                headers["Authorization"] = f"Bearer {token}"
        return headers

    def _deliver(self, seq: int, body: bytes, budget: float) -> bool:
        started = self._clock()
        delay = C.EVENT_RETRY_BASE_S
        refreshed = False
        force_token = False
        while True:
            retry = False
            try:
                headers = self._headers(seq, body, force_token=force_token)  # fresh timestamp per attempt
                force_token = False
                resp = self._client.post(self.callback_url, content=body, headers=headers)
                code = resp.status_code
                if 200 <= code < 300:
                    return True
                if code in (401, 403) and not refreshed and self._tokens is not None:
                    # An expired identity token; fetch a fresh one once. A bad signature (the app's own 401)
                    # fails again and is not retried further.
                    refreshed = True
                    force_token = True
                    retry = True
                elif code >= 500 or code in _RETRY_STATUSES:
                    retry = True
            except httpx.HTTPError:
                retry = True
            except Exception:
                retry = False
            if not retry or self._clock() - started + delay > budget:
                return False
            self._sleep(delay * random.uniform(0.75, 1.25))
            delay = min(delay * 2, C.EVENT_RETRY_MAX_DELAY_S)

    # -- finishing -----------------------------------------------------------------------------------

    def flush(self, timeout: float = C.EVENT_FLUSH_TIMEOUT_S) -> bool:
        """Send any pending trace batch now and wait until everything queued has been delivered or given up on."""
        end = self._clock() + timeout
        with self._cv:
            while self._buf or self._inflight or self._pending:
                self._seal_locked()
                remaining = end - self._clock()
                if remaining <= 0:
                    return False
                self._cv.wait(min(remaining, 0.5))
        return True

    def close(self, timeout: float = C.EVENT_FLUSH_TIMEOUT_S) -> bool:
        ok = self.flush(timeout)
        with self._cv:
            self._closed = True
            self._cv.notify_all()
        return ok
