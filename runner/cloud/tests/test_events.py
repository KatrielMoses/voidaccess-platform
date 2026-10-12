import hashlib
import hmac
import json
import threading
import time

import httpx

from cloud import constants as C
from cloud.events import EventSender
from cloud.identity import TokenSource

SECRET = "run-secret-0123456789abcdef"
URL = "https://app.example.test/api/engine/runs/r1/events"


class Recorder:
    """An httpx transport that records every request and answers from a script."""

    def __init__(self, script=None):
        self.requests: list[httpx.Request] = []
        self.script = list(script or [])
        self.gate: threading.Event | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.gate is not None:
            self.gate.wait(10)
        self.requests.append(request)
        step = self.script.pop(0) if self.script else 200
        if isinstance(step, Exception):
            raise step
        return httpx.Response(step)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))

    def seqs(self) -> list[int]:
        return [int(r.headers["x-va-seq"]) for r in self.requests]


def make(rec, **kw):
    kw.setdefault("sleep", lambda s: None)
    return EventSender(URL, SECRET, "r1", client=rec.client(), **kw)


def verify(req: httpx.Request) -> dict:
    body = req.content
    ts = req.headers["x-va-timestamp"]
    want = "sha256=" + hmac.new(SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    assert req.headers["x-va-signature"] == want
    assert abs(int(ts) - time.time()) < 30
    assert req.headers["x-va-run"] == "r1"
    payload = json.loads(body)
    assert payload["seq"] == int(req.headers["x-va-seq"]) and payload["run_id"] == "r1"
    return payload


def test_every_event_is_signed_and_seq_strictly_increases():
    rec = Recorder()
    s = make(rec)
    for i in range(5):
        s.emit({"type": "stage", "stage": "refine", "status": "start", "stage_index": 1})
    s.emit({"type": "completed"})
    assert s.close(5) and s.terminal_delivered
    assert rec.seqs() == [1, 2, 3, 4, 5, 6]
    payloads = [verify(r) for r in rec.requests]
    assert payloads[-1]["type"] == "completed" and all(p["stage_total"] == 8 for p in payloads)


def test_retries_5xx_and_network_errors_with_the_same_seq():
    rec = Recorder([503, httpx.ConnectError("boom"), 500, 200, 200])
    s = make(rec)
    s.emit({"type": "stage", "stage": "refine", "status": "start"})
    s.emit({"type": "completed"})
    assert s.close(5) and s.terminal_delivered
    assert rec.seqs() == [1, 1, 1, 1, 2]
    assert s.failed == 0 and s.sent == 2
    bodies = {r.content for r in rec.requests if r.headers["x-va-seq"] == "1"}
    assert len(bodies) == 1  # the same body each time; only the timestamp and signature are fresh


def test_a_4xx_is_not_retried_and_does_not_stop_later_events():
    rec = Recorder([400, 200])
    s = make(rec)
    s.emit({"type": "stage"})
    s.emit({"type": "failed", "reason": "error"})
    assert s.close(5)
    assert rec.seqs() == [1, 2] and s.failed == 1 and s.terminal_delivered


def test_gives_up_after_the_retry_budget():
    rec = Recorder([500] * 100)
    t = {"now": 0.0}
    s = make(rec, retry_budget_s=5, sleep=lambda d: t.__setitem__("now", t["now"] + d), clock=lambda: t["now"])
    s.emit({"type": "stage"})
    assert s.close(5)
    assert s.failed == 1 and 3 <= len(rec.requests) <= 12


def test_slow_app_never_blocks_the_pipeline_and_only_counts_are_dropped():
    rec = Recorder()
    rec.gate = threading.Event()  # the app does not answer
    s = make(rec, queue_max=4)
    start = time.monotonic()
    results = [s.emit({"type": "counts", "counts": {"pages_fetched": i}}) for i in range(50)]
    stage_ok = [s.emit({"type": "stage", "stage": "fetch", "status": "end"}) for _ in range(10)]
    elapsed = time.monotonic() - start
    assert elapsed < 1.0
    assert all(stage_ok)  # stage events are never dropped
    assert s.dropped_counts > 0 and not all(results)
    rec.gate.set()
    assert s.emit({"type": "completed"}) and s.close(10)
    seqs = rec.seqs()
    assert seqs == list(range(1, len(seqs) + 1)), "no gaps: a dropped counts event gets no seq"
    kinds = [json.loads(r.content)["type"] for r in rec.requests]
    assert kinds.count("stage") == 10 and kinds[-1] == "completed"


def test_exactly_one_terminal_event():
    rec = Recorder()
    s = make(rec)
    assert s.emit({"type": "failed", "reason": "deadline"})
    assert not s.emit({"type": "completed"})
    assert not s.emit({"type": "stage"})
    assert not s.emit({"type": "cancelled"})
    assert s.close(5)
    assert [json.loads(r.content)["type"] for r in rec.requests] == ["failed"]


def test_only_contract_fields_are_sent_and_messages_are_clamped():
    rec = Recorder()
    s = make(rec)
    s.emit({"type": "stage", "stage": "fetch", "status": "end", "duration_ms": 5, "call": "x", "args": [1], "message": "m" * 999})
    s.close(5)
    p = json.loads(rec.requests[0].content)
    assert "call" not in p and "args" not in p and len(p["message"]) == 300


def test_identity_token_is_attached_and_refreshed_once_on_401(monkeypatch):
    monkeypatch.delenv("VA_NO_AUTH", raising=False)
    monkeypatch.delenv("VA_ID_TOKEN", raising=False)
    issued = []

    class Tokens(TokenSource):
        def __init__(self):
            pass

        def id_token(self, audience, *, force=False):
            issued.append((audience, force))
            return "tok-forced" if force else "tok-1"

    rec = Recorder([401, 200])
    s = EventSender(URL, SECRET, "r1", tokens=Tokens(), client=rec.client(), sleep=lambda d: None)
    s.emit({"type": "completed"})
    assert s.close(5) and s.terminal_delivered
    assert [r.headers["authorization"] for r in rec.requests] == ["Bearer tok-1", "Bearer tok-forced"]
    assert issued[0] == ("https://app.example.test", False) and issued[1][1] is True


def test_constants_are_sane():
    assert C.EVENT_QUEUE_MAX >= 64 and C.TERMINAL_RETRY_BUDGET_S >= C.EVENT_RETRY_BUDGET_S
