"""Signed, retrying, non-blocking delivery of progress events to the app.

Guarantee 4: each callback is HMAC-signed over "<timestamp>.<raw body>", carries a strictly increasing
`seq`, and is retried with backoff on a 5xx or a network error. A slow app never blocks the pipeline:
the engine's sink only enqueues, and one worker thread delivers in order. Events are never dropped,
except an intermediate `counts` event when the queue is full (it is not given a seq, so the delivered
sequence has no gaps). Exactly one terminal event is ever sent per run.
"""

from __future__ import annotations

import json
import random
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable

import httpx

from . import constants as C
from .identity import TokenSource, audience_for
from .signing import sign_callback

TERMINAL_TYPES = ("completed", "failed", "cancelled")
# Contract fields the app's ProgressEvent schema accepts; anything else is dropped before sending.
_ALLOWED_FIELDS = (
    "type",
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

        self._cv = threading.Condition()
        self._buf: deque[tuple[int, bytes, bool]] = deque()  # (seq, body, terminal)
        self._seq = 0
        self._terminal_enqueued = False
        self._terminal_delivered = False
        self._closed = False
        self._inflight = False
        self.sent = 0
        self.dropped_counts = 0
        self.failed = 0
        self.last_seq_sent = 0
        self._worker = threading.Thread(target=self._drain, name="va-events", daemon=True)
        self._worker.start()

    # -- producing -----------------------------------------------------------------------------------

    def emit(self, event: dict[str, Any]) -> bool:
        """Stamp, serialize and enqueue `event`. Never blocks and never raises. False if not enqueued."""
        try:
            etype = event.get("type")
            terminal = etype in TERMINAL_TYPES
            payload = {k: event[k] for k in _ALLOWED_FIELDS if event.get(k) is not None}
            payload["stage_total"] = 8
            payload["run_id"] = self.run_id
            payload.setdefault("at", utc_now_iso())
            if isinstance(payload.get("message"), str):
                payload["message"] = payload["message"][:_MESSAGE_MAX]
            with self._cv:
                if self._closed or self._terminal_enqueued:
                    return False
                if etype == "counts" and len(self._buf) >= self._queue_max:
                    self.dropped_counts += 1
                    return False
                self._seq += 1
                payload["seq"] = self._seq
                body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
                if terminal:
                    self._terminal_enqueued = True
                self._buf.append((self._seq, body, terminal))
                self._cv.notify_all()
            return True
        except Exception:
            return False

    @property
    def terminal_enqueued(self) -> bool:
        return self._terminal_enqueued

    @property
    def terminal_delivered(self) -> bool:
        return self._terminal_delivered

    # -- consuming -----------------------------------------------------------------------------------

    def _drain(self) -> None:
        while True:
            with self._cv:
                while not self._buf and not self._closed:
                    self._cv.wait()
                if not self._buf and self._closed:
                    return
                seq, body, terminal = self._buf.popleft()
                self._inflight = True
            ok = False
            try:
                ok = self._deliver(seq, body, terminal)
            except Exception:
                ok = False
            with self._cv:
                self._inflight = False
                if ok:
                    self.sent += 1
                    self.last_seq_sent = seq
                    if terminal:
                        self._terminal_delivered = True
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

    def _deliver(self, seq: int, body: bytes, terminal: bool) -> bool:
        budget = self._terminal_budget if terminal else self._retry_budget
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
        """Wait until everything queued has been delivered or given up on."""
        end = self._clock() + timeout
        with self._cv:
            while self._buf or self._inflight:
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
