"""Contract v2: trace events are sanitized, batched, ordered with the schema-1 events and dropped first under
backpressure."""

import hashlib
import hmac
import json
import threading
import time

import httpx

from cloud import constants as C
from cloud.events import EventSender
from cloud.trace import TRACE_KINDS, sanitize_trace

SECRET = "run-secret-0123456789abcdef"
URL = "https://app.example.test/api/engine/runs/r1/events"
KEY = "sk-or-v1-0123456789abcdef"


class Recorder:
    """An httpx transport that records every request; `status(body)` picks the answer, `gate` holds it back."""

    def __init__(self, status=None):
        self.requests: list[httpx.Request] = []
        self.status = status or (lambda body: 200)
        self.gate: threading.Event | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.gate is not None:
            self.gate.wait(10)
        self.requests.append(request)
        return httpx.Response(self.status(json.loads(request.content)))

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


def make(rec, **kw):
    kw.setdefault("sleep", lambda s: None)
    return EventSender(URL, SECRET, "r1", client=rec.client(), **kw)


def trace(kind="url.kept", stage="filter", **data):
    return {"type": "trace", "stage": stage, "kind": kind, "data": data or {"url_id": "u1", "score": 0.5}}


def verify_sig(req: httpx.Request) -> dict:
    ts = req.headers["x-va-timestamp"]
    want = "sha256=" + hmac.new(SECRET.encode(), f"{ts}.".encode() + req.content, hashlib.sha256).hexdigest()
    assert req.headers["x-va-signature"] == want and req.headers["x-va-run"] == "r1"
    return json.loads(req.content)


def bodies(rec):
    return [json.loads(r.content) for r in rec.requests]


def event_seqs(rec) -> list[int]:
    """Every delivered event's seq, batches expanded, in delivery order."""
    out = []
    for b in bodies(rec):
        out += [e["seq"] for e in b["events"]] if "events" in b else [b["seq"]]
    return out


def wait_for(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return cond()


# -- batching ------------------------------------------------------------------------------------------------------


def test_fifty_traces_are_one_signed_batch_with_the_last_seq_in_the_header():
    rec = Recorder()
    s = make(rec)
    for i in range(50):
        assert s.emit(trace(url_id=f"u{i}"))
    assert wait_for(lambda: len(rec.requests) == 1, 1.0)  # sealed at 50, without waiting for the timer
    assert s.close(5)
    (req,) = rec.requests
    batch = verify_sig(req)
    assert set(batch) == {"schema", "run_id", "events"} and batch["schema"] == 2 and batch["run_id"] == "r1"
    assert [e["seq"] for e in batch["events"]] == list(range(1, 51))
    assert int(req.headers["x-va-seq"]) == 50 == batch["events"][-1]["seq"]
    for e in batch["events"]:
        assert set(e) == {"type", "schema", "run_id", "seq", "at", "stage", "kind", "data"}
        assert e["type"] == "trace" and e["schema"] == 2 and e["run_id"] == "r1"
    assert b" " not in req.content  # compact JSON
    assert s.traces_sent == 50 and s.trace_batches_sent == 1 and s.sent == 0


def test_a_partial_batch_is_sent_after_the_wait_without_more_events():
    rec = Recorder()
    t = {"now": 100.0}
    s = make(rec, clock=lambda: t["now"])
    for i in range(3):
        s.emit(trace(url_id=f"u{i}"))
    time.sleep(0.4)  # real time passes, the injected clock does not: not yet due
    assert rec.requests == []
    t["now"] += C.TRACE_BATCH_MAX_WAIT_S + 0.01
    assert wait_for(lambda: len(rec.requests) == 1)  # no flush(), no further emit: the worker's timer sends it
    assert [e["seq"] for e in bodies(rec)[0]["events"]] == [1, 2, 3]
    assert int(rec.requests[0].headers["x-va-seq"]) == 3
    s.close(5)


def test_a_partial_batch_is_sent_within_the_real_wait():
    rec = Recorder()
    s = make(rec)
    s.emit(trace())
    assert wait_for(lambda: len(rec.requests) == 1, C.TRACE_BATCH_MAX_WAIT_S + 2)
    s.close(5)


def test_flush_sends_a_pending_batch_immediately():
    rec = Recorder()
    s = make(rec, trace_batch_wait_s=60)
    s.emit(trace())
    s.emit(trace())
    assert s.flush(5)
    assert len(rec.requests) == 1 and len(bodies(rec)[0]["events"]) == 2
    s.close(5)


# -- ordering ------------------------------------------------------------------------------------------------------


def test_pending_traces_go_out_before_the_next_schema1_event_and_seqs_strictly_increase():
    rec = Recorder()
    s = make(rec, trace_batch_wait_s=60)
    s.emit({"type": "stage", "stage": "collect", "status": "start", "stage_index": 2})
    for i in range(120):  # 50 + 50 + 20 (the last 20 sealed by the stage event)
        s.emit(trace("url.found", "collect", url_id=f"u{i}", host="example[.]com", engine="ahmia"))
    s.emit({"type": "stage", "stage": "collect", "status": "end", "stage_index": 2})
    s.emit(trace("graph.progress", "graph", nodes=1, edges=0))
    s.emit({"type": "completed"})
    assert s.close(5) and s.terminal_delivered
    got = bodies(rec)
    shape = [("batch", len(b["events"])) if "events" in b else (b["type"], 1) for b in got]
    assert shape == [("stage", 1), ("batch", 50), ("batch", 50), ("batch", 20), ("stage", 1), ("batch", 1), ("completed", 1)]
    seqs = event_seqs(rec)
    assert seqs == list(range(1, len(seqs) + 1))
    headers = [int(r.headers["x-va-seq"]) for r in rec.requests]
    assert headers == sorted(headers) and len(set(headers)) == len(headers)


def test_every_event_carries_schema_2():
    rec = Recorder()
    s = make(rec)
    s.emit({"type": "counts", "counts": {"pages_fetched": 1}})
    s.emit({"type": "refined", "refined_queries": ["a"]})
    s.emit({"type": "stage", "stage": "refine", "status": "end", "schema": 1})
    s.emit(trace("query.refined", "refine", index=0, text="a"))
    s.emit({"type": "failed", "reason": "error"})
    assert s.close(5)
    got = bodies(rec)
    assert all(b["schema"] == 2 for b in got)
    assert all(e["schema"] == 2 for b in got if "events" in b for e in b["events"])
    singles = [b for b in got if "events" not in b]
    assert [b["type"] for b in singles] == ["counts", "refined", "stage", "failed"]


def test_traces_after_the_terminal_event_are_refused():
    rec = Recorder()
    s = make(rec)
    s.emit({"type": "completed"})
    assert not s.emit(trace())
    s.close(5)
    assert [b.get("type") for b in bodies(rec)] == ["completed"]


# -- backpressure --------------------------------------------------------------------------------------------------


def test_a_stuck_app_drops_traces_first_and_never_loses_stage_or_terminal_events():
    rec = Recorder()
    rec.gate = threading.Event()  # the app does not answer
    s = make(rec, queue_max=8, trace_queue_max=200)
    start = time.monotonic()
    accepted = 0
    for round_ in range(10):
        for i in range(500):
            accepted += s.emit(trace(url_id=f"u{i}"))
        s.emit({"type": "counts", "counts": {"pages_fetched": round_}})
        assert s.emit({"type": "stage", "stage": "fetch", "status": "start" if round_ == 0 else "end"})
    assert s.emit({"type": "refined", "refined_queries": ["x"]})
    assert s.emit({"type": "completed"})
    elapsed = time.monotonic() - start
    assert elapsed < 2.0, f"emit() blocked: {elapsed:.2f}s for 5000 traces"
    assert s.dropped_traces > 4000 and accepted <= 5000 - s.dropped_traces
    assert s.evicted_traces > 0  # counts made room by evicting old trace batches
    rec.gate.set()
    assert s.close(10) and s.terminal_delivered
    got = bodies(rec)
    singles = [b["type"] for b in got if "events" not in b]
    assert singles.count("stage") == 10 and "refined" in singles and singles[-1] == "completed"
    assert singles.count("counts") == 10  # every counts event found a batch to evict
    seqs = event_seqs(rec)
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)  # gaps allowed, never out of order
    assert s.evicted_traces + s.traces_sent + s.failed_traces == accepted


def test_counts_is_dropped_only_when_there_is_no_trace_batch_to_evict():
    rec = Recorder()
    rec.gate = threading.Event()
    s = make(rec, queue_max=2)
    s.emit({"type": "stage", "stage": "fetch", "status": "start"})  # in flight, stuck
    s.emit({"type": "stage", "stage": "fetch", "status": "end"})
    s.emit({"type": "stage", "stage": "extract", "status": "start"})
    assert wait_for(lambda: s._inflight)
    assert not s.emit({"type": "counts", "counts": {}}) and s.dropped_counts == 1
    s.emit(trace())
    assert s.emit({"type": "counts", "counts": {}})  # seals the trace into a batch, then evicts it
    assert s.evicted_traces == 1 and s.dropped_counts == 1
    rec.gate.set()
    s.emit({"type": "completed"})
    assert s.close(5)


def test_a_failing_app_abandons_trace_batches_quickly_and_still_delivers_the_terminal_event():
    rec = Recorder(lambda body: 500 if "events" in body else 200)  # the app cannot take batches at all
    t = {"now": 0.0}
    s = make(rec, sleep=lambda d: t.__setitem__("now", t["now"] + d), clock=lambda: t["now"])
    for i in range(50):
        s.emit(trace(url_id=f"u{i}"))
    s.emit({"type": "completed"})
    assert wait_for(lambda: s.terminal_delivered)
    s.close(5)
    assert s.failed_traces == 50 and s.traces_sent == 0 and s.failed == 0
    batch_attempts = [r for r in rec.requests if "events" in json.loads(r.content)]
    assert 2 <= len(batch_attempts) <= 6  # a 5 s budget, not the 120 s one
    assert bodies(rec)[-1]["type"] == "completed"


def test_constants_are_sane():
    assert 1 <= C.TRACE_BATCH_MAX_EVENTS <= 100  # the app accepts at most 100 per batch
    assert C.TRACE_RETRY_BUDGET_S < C.EVENT_RETRY_BUDGET_S
    assert C.TRACE_QUEUE_MAX_EVENTS >= C.TRACE_BATCH_MAX_EVENTS


# -- sanitizing ----------------------------------------------------------------------------------------------------


def test_safety_drops_carry_only_the_url_id_and_the_reason():
    d = sanitize_trace(trace("url.dropped", url_id="u7", reason="safety", host="bad[.]onion", why="csam"))
    assert d["data"] == {"url_id": "u7", "reason": "safety"}
    p = sanitize_trace(
        trace("page.fetched", "fetch", url_id="u7", outcome="safety_dropped", http_status=200, bytes=5, host="x[.]com")
    )
    assert p["data"] == {"url_id": "u7", "outcome": "safety_dropped"}
    assert sanitize_trace(trace("url.dropped", url_id="https://bad.onion/x", reason="safety")) is None


def test_safety_stripping_happens_on_the_wire():
    rec = Recorder()
    s = make(rec)
    s.emit(trace("url.dropped", url_id="u7", reason="safety", host="bad[.]onion", detail="secret page title"))
    assert s.close(5)
    (ev,) = bodies(rec)[0]["events"]
    assert ev["data"] == {"url_id": "u7", "reason": "safety"}


def test_unknown_stages_kinds_and_malformed_required_fields_are_dropped():
    assert sanitize_trace(trace(stage="crawl")) is None
    assert sanitize_trace(trace(kind="page.screenshot")) is None
    assert sanitize_trace({"type": "trace", "stage": "filter", "kind": "url.kept", "data": "u1"}) is None
    assert sanitize_trace(trace("url.kept", url_id="https://x")) is None
    assert sanitize_trace(trace("search.result", "collect", engine="ahmia", query_index=0, status="weird", results=1)) is None
    rec = Recorder()
    s = make(rec)
    assert not s.emit(trace(stage="crawl"))
    assert s.dropped_traces == 1
    s.emit({"type": "completed"})
    assert s.close(5)
    assert [int(r.headers["x-va-seq"]) for r in rec.requests] == [1]  # a refused trace takes no seq


def test_url_found_hosts_must_be_display_hosts():
    ok = trace("url.found", "collect", url_id="u1", host="abcdefgh…wxyz[.]onion", engine="ahmia", depth=0)
    assert sanitize_trace(ok)["data"]["host"] == "abcdefgh…wxyz[.]onion"
    for host in ("http://example[.]com", "example[.]com/path", "example[.]com?q=1", "exa mple[.]com", "example.com"):
        assert sanitize_trace(trace("url.found", "collect", url_id="u1", host=host)) is None, host


def test_what_the_real_engine_sends_passes_masked_hosts_named_sources_and_the_error_outcome():
    events = [
        trace("url.found", "collect", url_id="u1", host="********…fcid[.]onion", engine="The Deep Searches"),
        trace("search.request", "collect", engine="Ahmia (Clearnet Proxy)", query_index=0),
        trace("search.result", "collect", engine="Ahmia (Clearnet Proxy)", query_index=0, status="ok", results=12),
        trace("enrich.source", "enrich", source="Shodan InternetDB", status="ok", hits=3),
        trace("page.fetched", "fetch", url_id="u1", outcome="error"),
    ]
    for e in events:
        assert sanitize_trace(e) is not None, e
    for engine in ("<b>x</b>", "a/b", "x" * 41, "tab\there"):
        assert sanitize_trace(trace("search.request", "collect", engine=engine, query_index=0)) is None, engine


def test_text_and_display_are_truncated_and_unknown_fields_removed():
    q = sanitize_trace(trace("query.refined", "refine", index=1, text="q" * 500, extra="nope"))
    assert q["data"] == {"index": 1, "text": "q" * 200}
    e = sanitize_trace(trace("entity.found", "extract", entity_id="e1", type="email", display="j***@x[.]com" + "z" * 200))
    assert len(e["data"]["display"]) == 80
    assert sanitize_trace(trace("entity.found", "extract", entity_id="e1", type="email", display="john.doe@corp.com")) is None
    assert sanitize_trace(trace("entity.found", "extract", entity_id="e1", type="url", display="http://x.onion")) is None


def test_optional_fields_that_are_malformed_are_left_out():
    p = sanitize_trace(trace("page.fetched", "fetch", url_id="u1", outcome="ok", http_status=9999, ms=12.6, bytes=-1))
    assert p["data"] == {"url_id": "u1", "outcome": "ok", "ms": 13}
    k = sanitize_trace(trace("url.kept", url_id="u1", score=1.7))
    assert k["data"] == {"url_id": "u1"}
    pe = sanitize_trace(trace("page.entities", "extract", url_id="u1", by_type={"email": 2, "bad key": 1, "btc": -1}))
    assert pe["data"] == {"url_id": "u1", "by_type": {"email": 2}}


def test_every_known_kind_has_a_minimal_valid_example():
    examples = {
        "query.refined": {"index": 0, "text": "t"},
        "search.request": {"engine": "ahmia", "query_index": 0},
        "search.result": {"engine": "ahmia", "query_index": 0, "status": "ok", "results": 3},
        "url.found": {"url_id": "u1", "host": "example[.]com"},
        "url.kept": {"url_id": "u1"},
        "url.dropped": {"url_id": "u1", "reason": "duplicate"},
        "page.fetched": {"url_id": "u1", "outcome": "http_404", "http_status": 404},
        "page.entities": {"url_id": "u1", "by_type": {}},
        "entity.found": {"entity_id": "e1", "type": "btc", "display": "bc1q***xyz"},
        "enrich.source": {"source": "otx", "status": "no_key"},
        "graph.progress": {"nodes": 1, "edges": 0},
        "summary.status": {"kind": "fallback"},
        "trace.truncated": {"kind": "url.found", "dropped": 12},
        "filter_fallback": {"scope": "clearnet", "candidates": 12, "kept": 12},
    }
    assert set(examples) == set(TRACE_KINDS)
    for kind, data in examples.items():
        out = sanitize_trace({"type": "trace", "stage": "graph", "kind": kind, "data": data})
        assert out is not None and out["data"] == data, kind


def test_the_callback_secret_and_api_key_are_redacted_from_trace_strings_but_the_query_is_not():
    rec = Recorder()
    s = EventSender(URL, SECRET, "r1", client=rec.client(), sleep=lambda d: None, redact=[KEY, None])
    s.emit(trace("query.refined", "refine", index=0, text=f"lockbit {SECRET} and {KEY}"))
    s.emit(trace("entity.found", "extract", entity_id="e1", type="api_key", display=f"{KEY}"))
    assert s.close(5)
    events = bodies(rec)[0]["events"]
    assert events[0]["data"]["text"] == "lockbit [redacted] and [redacted]"
    assert events[1]["data"]["display"] == "[redacted]"
    assert SECRET not in rec.requests[0].content.decode() and KEY not in rec.requests[0].content.decode()


def test_an_enum_stage_from_the_engine_is_accepted():
    class Stage:
        value = "fetch"

    out = sanitize_trace({"type": "trace", "stage": Stage(), "kind": "url.kept", "data": {"url_id": "u3"}})
    assert out["stage"] == "fetch"


def test_filter_fallback_keeps_counts_only_and_rejects_bad_scopes():
    ok = sanitize_trace(trace("filter_fallback", "filter", scope="onion", candidates=40, kept=40, host="x[.]onion"))
    assert ok["data"] == {"scope": "onion", "candidates": 40, "kept": 40}
    assert sanitize_trace(trace("filter_fallback", "filter", scope="web", candidates=1, kept=1)) is None
    assert sanitize_trace(trace("filter_fallback", "filter", scope="onion", candidates=-1, kept=1)) is None
