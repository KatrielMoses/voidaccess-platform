"""The runner's terminal-event guarantees (3) and its handling of cancel, deadline, crash and blocked queries,
driven through `Run.run()` with a fake engine, fake Tor and a recording callback endpoint."""

import asyncio
import json
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest

pytest.importorskip("utils.content_safety", reason="engine tree not on PYTHONPATH")
progress = pytest.importorskip("progress", reason="engine tree not on PYTHONPATH")

from cloud import constants as C  # noqa: E402
from cloud import run as run_mod  # noqa: E402
from cloud.events import EventSender  # noqa: E402

RUN_ID = "0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5d"
STAGES = [s.value for s in progress.Stage]


class World:
    """Everything the runner talks to, faked."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.order: list[str] = []  # "upload", "tor", "event:<type>" in the order they happened
        self.died = threading.Event()
        self.tor_started = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(request)
        self.order.append("batch" if "events" in body else "event:" + body["type"])
        return httpx.Response(200)

    def events(self) -> list[dict]:
        """Every delivered event in delivery order, trace batches expanded."""
        out: list[dict] = []
        for r in self.requests:
            body = json.loads(r.content)
            out += body["events"] if "events" in body else [body]
        return out

    def traces(self) -> list[dict]:
        return [e for e in self.events() if e["type"] == "trace"]

    def terminals(self) -> list[dict]:
        return [e for e in self.events() if e["type"] in ("completed", "failed", "cancelled")]


def spec(query="lockbit leak site", depth="quick", deadline=None):
    deadline = deadline or (datetime.now(timezone.utc) + timedelta(minutes=30))
    return {
        "run_id": RUN_ID, "query": query, "depth": depth,
        "callback_url": f"https://app.example.test/api/engine/runs/{RUN_ID}/events",
        "callback_secret": "0123456789abcdef-secret",
        "artifact_put_urls": {"bundle": f"gs://voidaccess-cloud-runs/runs/{RUN_ID}/bundle.json", "exports": {}},
        "deadline_at": deadline.isoformat(),
    }


@pytest.fixture
def world(monkeypatch, tmp_path):
    w = World()
    monkeypatch.setenv("VA_NO_AUTH", "1")  # no metadata server here: send the callbacks without an identity token
    monkeypatch.setattr(run_mod, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(run_mod.scrub, "install_stream_scrubbers", lambda: None)
    monkeypatch.setattr(run_mod.signal, "signal", lambda *a, **k: None)
    monkeypatch.setattr(
        run_mod, "EventSender",
        lambda *a, **k: EventSender(*a, client=httpx.Client(transport=httpx.MockTransport(w.handler)), sleep=lambda s: None, **k),
    )
    monkeypatch.setattr(run_mod.Run, "_die", lambda self: w.died.set())
    monkeypatch.setattr(run_mod.Run, "_setup_engine_env", lambda self, q, d: "shallow")
    monkeypatch.setattr(run_mod.Run, "_prepare_engine", lambda self, key: None)
    monkeypatch.setattr(run_mod.Run, "build_metrics", lambda self, live_prices=True: {"duration_ms": 1.0})

    from cloud import tor

    def fake_tor(should_stop=lambda: False, **kw):
        w.tor_started = True
        w.order.append("tor")
        return None, 1234.0, 1

    monkeypatch.setattr(tor, "start_tor_with_retry", fake_tor)
    monkeypatch.setattr(tor, "stop_tor", lambda p: None)
    monkeypatch.setattr(tor, "start_jitter_s", lambda rng=None: 0.0)

    def finalize(self, out_dir):
        w.order.append("upload")
        return {"duration_ms": 5.0}

    monkeypatch.setattr(run_mod.Run, "finalize_and_upload", finalize)
    return w


def make_run(monkeypatch, world, sp=None, key="sk-test-0123456789"):
    sp = sp or spec()
    monkeypatch.setattr(run_mod, "fetch_spec", lambda *a, **k: sp)
    env = {"SPEC_URL": "https://app.example.test/spec?t=x", "RUN_ID": RUN_ID, "OPENROUTER_API_KEY": key}
    return run_mod.Run(env=env, tokens=None)


def engine_events(run, *, terminal="completed", reason=None, stages=STAGES, crash=None, traces=False):
    """A fake engine: stage start/end for each stage, a refined event, counts, then its own terminal event. With
    `traces`, contract-v2 trace events too (as plain dicts: the engine's ProgressEvent may not carry them yet)."""

    async def fake(self, query, cli_depth, out_dir, timeout_s):
        emit = lambda **kw: self.on_engine_event(progress.ProgressEvent(**kw))  # noqa: E731
        for i, st in enumerate(stages, 1):
            stage = progress.Stage(st)
            emit(type="stage", stage=stage, stage_index=i, status="start")
            if st == "refine":
                emit(type="refined", refined_queries=["lockbit"])
            if traces:
                for n in range(3):
                    self.on_engine_event(
                        {"type": "trace", "schema": 2, "stage": st, "kind": "url.kept", "data": {"url_id": f"u{i}{n}"}}
                    )
            emit(type="counts", counts={"sources_queried": 3, "results_found": 9, "pages_fetched": i, "entities_found": i, "actors_found": 0})
            emit(type="stage", stage=stage, stage_index=i, status="end", duration_ms=10 * i)
            await asyncio.sleep(0)
        if crash:
            raise crash
        if terminal == "completed":
            emit(type="completed")
        else:
            emit(type="failed", reason=reason)

    run_mod.Run._run_engine = fake  # restored by monkeypatch fixture below


@pytest.fixture(autouse=True)
def restore_engine(monkeypatch):
    monkeypatch.setattr(run_mod.Run, "_run_engine", run_mod.Run._run_engine)


def seqs_ok(world):
    seqs = [e["seq"] for e in world.events()]
    assert seqs == list(range(1, len(seqs) + 1)), seqs
    headers = [int(r.headers["x-va-seq"]) for r in world.requests]
    assert headers == [json.loads(r.content).get("seq") or json.loads(r.content)["events"][-1]["seq"] for r in world.requests]


def test_completed_is_sent_once_and_only_after_the_upload(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_events(run)
    code = run.run()
    assert code == 0 and run.delivered
    (terminal,) = world.terminals()
    assert terminal["type"] == "completed" and terminal["metrics"] == {"duration_ms": 5.0}
    assert world.order.index("upload") < world.order.index("event:completed") == len(world.order) - 1
    seqs_ok(world)
    events = world.events()
    stage_events = [(e["stage"], e["status"]) for e in events if e["type"] == "stage"]
    assert stage_events == [(s, st) for s in STAGES for st in ("start", "end")]  # in the engine's order, none lost
    assert events[0]["type"] == "counts" and events[0]["message"] == "starting"
    assert any(e["type"] == "refined" and e["refined_queries"] == ["lockbit"] for e in events)


def test_engine_failure_no_results_is_forwarded_as_the_one_terminal_event(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_events(run, terminal="failed", reason="no_results", stages=STAGES[:4])
    assert run.run() == 0  # G10: no_results is not a crash
    (t,) = world.terminals()
    assert t["type"] == "failed" and t["reason"] == "no_results" and t["stages_completed"] == STAGES[:4]
    assert "upload" not in world.order


def test_an_engine_crash_is_one_failed_error_event_with_the_stages_done(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_events(run, stages=STAGES[:2], crash=RuntimeError("provider exploded lockbit leak site"))
    assert run.run() == 1
    (t,) = world.terminals()
    assert t["type"] == "failed" and t["reason"] == "error" and t["stages_completed"] == STAGES[:2]
    assert "lockbit" not in json.dumps(t)  # the exception text (which may quote the query) is not sent
    assert "upload" not in world.order


def test_an_upload_failure_ends_failed_error_not_completed(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_events(run)

    def boom(self, out_dir):
        raise run_mod.UploadError("upload failed (status 403)")

    monkeypatch.setattr(run_mod.Run, "finalize_and_upload", boom)
    assert run.run() == 1
    (t,) = world.terminals()
    assert (t["type"], t["reason"]) == ("failed", "error")


def test_blocked_query_fails_before_tor_or_any_collection(monkeypatch, world):
    from utils.content_safety import CONTENT_BLOCKLIST

    run = make_run(monkeypatch, world, spec(query=f"find {CONTENT_BLOCKLIST[0]} please"))
    engine_events(run, traces=True)
    assert run.run() == 0
    (t,) = world.terminals()
    assert (t["type"], t["reason"]) == ("failed", "blocked_query") and t["stages_completed"] == []
    assert not world.tor_started
    assert not [e for e in world.events() if e["type"] == "stage"]
    assert world.traces() == [] and "batch" not in world.order  # a blocked query emits no trace at all
    assert [e["type"] for e in world.events()] == ["counts", "failed"]


def test_an_already_expired_deadline_fails_with_deadline_immediately(monkeypatch, world):
    sp = spec(deadline=datetime.now(timezone.utc) - timedelta(seconds=5))
    run = make_run(monkeypatch, world, sp)
    engine_events(run)
    assert run.run() == 0
    (t,) = world.terminals()
    assert (t["type"], t["reason"]) == ("failed", "deadline")
    assert not world.tor_started and len(world.events()) == 1


def test_the_launcher_deadline_env_can_tighten_the_spec_deadline(monkeypatch, world):
    run = make_run(monkeypatch, world)
    run.env["DEADLINE_AT"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    engine_events(run)
    assert run.run() == 0
    assert world.terminals()[0]["reason"] == "deadline"


def test_the_wall_clock_cap_cancels_a_slow_engine_and_fails_with_deadline(monkeypatch, world):
    monkeypatch.setitem(C.WALL_CLOCK_CAP_S, "quick", 1.0)
    monkeypatch.setattr(C, "FINALIZE_RESERVE_S", 0.0)
    run = make_run(monkeypatch, world)

    async def slow(self, query, cli_depth, out_dir, timeout_s):
        await asyncio.wait_for(asyncio.sleep(30), timeout=timeout_s)

    monkeypatch.setattr(run_mod.Run, "_run_engine", slow)
    t0 = time.monotonic()
    code = run.run()
    assert time.monotonic() - t0 < 10 and code == 0
    (t,) = world.terminals()
    assert (t["type"], t["reason"]) == ("failed", "deadline")


def test_a_hung_blocking_engine_is_caught_by_the_watchdog_thread(monkeypatch, world):
    monkeypatch.setitem(C.WALL_CLOCK_CAP_S, "quick", 0.6)
    monkeypatch.setattr(C, "FINALIZE_RESERVE_S", 0.0)
    run = make_run(monkeypatch, world)
    release = threading.Event()

    async def hung(self, query, cli_depth, out_dir, timeout_s):
        release.wait(5)  # blocks the event loop thread: wait_for cannot fire

    monkeypatch.setattr(run_mod.Run, "_run_engine", hung)
    threading.Timer(2.5, release.set).start()
    code = run.run()
    assert world.died.wait(3), "the watchdog should have ended the process"
    (t,) = world.terminals()
    assert (t["type"], t["reason"]) == ("failed", "deadline") and code == 0
    seqs_ok(world)


def test_sigterm_cancel_emits_cancelled_with_stages_completed_and_uploads_nothing(monkeypatch, world):
    run = make_run(monkeypatch, world)
    reached = threading.Event()

    async def fake(self, query, cli_depth, out_dir, timeout_s):
        emit = lambda **kw: self.on_engine_event(progress.ProgressEvent(**kw))  # noqa: E731
        for i, st in enumerate(STAGES[:3], 1):
            emit(type="stage", stage=progress.Stage(st), stage_index=i, status="start")
            emit(type="stage", stage=progress.Stage(st), stage_index=i, status="end", duration_ms=5)
        reached.set()
        while True:  # a long-running stage
            await asyncio.sleep(0.05)

    monkeypatch.setattr(run_mod.Run, "_run_engine", fake)

    def killer():
        reached.wait(5)
        time.sleep(0.2)
        run.cancel_requested.set()  # what the SIGTERM handler does

    threading.Thread(target=killer, daemon=True).start()
    threading.Thread(target=lambda: (world.died.wait(8) and None), daemon=True).start()
    result = {}
    t = threading.Thread(target=lambda: result.setdefault("code", run.run()), daemon=True)
    t.start()
    assert world.died.wait(8), "cancel should end the process"
    (term,) = world.terminals()
    assert term["type"] == "cancelled" and term["stages_completed"] == STAGES[:3]
    assert "upload" not in world.order
    seqs_ok(world)


def test_sigterm_during_tor_bootstrap_still_cancels(monkeypatch, world):
    from cloud import tor

    run = make_run(monkeypatch, world)
    engine_events(run)

    def slow_tor(should_stop=lambda: False, **kw):
        while not should_stop():
            time.sleep(0.02)
        raise tor.TorError("stopped")

    monkeypatch.setattr(tor, "start_tor_with_retry", slow_tor)
    threading.Timer(0.3, run.cancel_requested.set).start()
    threading.Thread(target=run.run, daemon=True).start()
    assert world.died.wait(8)
    (term,) = world.terminals()
    assert term["type"] == "cancelled" and term["stages_completed"] == []


def test_the_wall_clock_override_can_tighten_the_cap_but_not_loosen_it(monkeypatch, world):
    monkeypatch.setattr(C, "FINALIZE_RESERVE_S", 0.0)
    run = make_run(monkeypatch, world)
    run.env["VA_WALL_CLOCK_CAP_S"] = "1"  # the depth cap is 480 s: the override wins because it is lower

    async def slow(self, query, cli_depth, out_dir, timeout_s):
        await asyncio.wait_for(asyncio.sleep(30), timeout=timeout_s)

    monkeypatch.setattr(run_mod.Run, "_run_engine", slow)
    t0 = time.monotonic()
    assert run.run() == 0 and time.monotonic() - t0 < 10
    assert world.terminals()[0]["reason"] == "deadline"


# ---- contract v2: trace events ----------------------------------------------------------------------------------


def test_trace_events_are_forwarded_in_batches_in_seq_order_and_never_touch_the_run_state(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_events(run, traces=True)
    assert run.run() == 0 and run.delivered
    seqs_ok(world)
    traces = world.traces()
    assert len(traces) == 3 * len(STAGES)
    assert all(t["schema"] == 2 and t["run_id"] == RUN_ID and t["kind"] == "url.kept" for t in traces)
    assert all(e["schema"] == 2 for e in world.events())
    assert "batch" in world.order and world.order[-1] == "event:completed"
    stage_ends = [i for i, e in enumerate(world.events()) if e["type"] == "stage" and e["status"] == "end"]
    for st, end in zip(STAGES, stage_ends):  # each stage's traces arrive before that stage's end event
        assert all(i < end for i, e in enumerate(world.events()) if e["type"] == "trace" and e["stage"] == st)
    (terminal,) = world.terminals()
    assert terminal["counts"]["pages_fetched"] == len(STAGES)  # last_counts came from counts events only


def test_on_engine_event_forwards_traces_from_objects_and_dicts_without_recording_them(monkeypatch):
    sent = []

    class Sender:
        def emit(self, d):
            sent.append(d)
            return True

    class Obj:
        def to_dict(self):
            return {"type": "trace", "schema": 2, "stage": "fetch", "kind": "page.fetched",
                    "data": {"url_id": "u1", "outcome": "ok"}, "counts": {"pages_fetched": 99}}

    run = run_mod.Run(env={}, tokens=None)
    run.sender = Sender()
    run.on_engine_event(Obj())
    run.on_engine_event({"type": "trace", "stage": "graph", "kind": "graph.progress", "data": {"nodes": 1, "edges": 0}})
    assert [d["kind"] for d in sent] == ["page.fetched", "graph.progress"]
    assert run.state.last_counts == {} and run.state.stages_completed == [] and run.state.engine_terminal is None


def test_the_engine_env_setup_turns_trace_events_on(monkeypatch, tmp_path):
    import os

    saved = dict(os.environ)
    monkeypatch.delenv("VOIDACCESS_TRACE_EVENTS", raising=False)
    try:
        run = run_mod.Run(env={}, tokens=None)
        run.work = tmp_path
        run._setup_engine_env("lockbit leak site", "quick")
        assert os.environ["VOIDACCESS_TRACE_EVENTS"] == "1"
    finally:
        os.environ.clear()
        os.environ.update(saved)


# -- R2b: unreachable sources end as `failed: sources_unreachable` (G5) ----------------------------------------------

def engine_with_sources(run, *, engines_ok: int, engines_failed: int, onion_pages_ok: int, clearnet_pages_ok: int = 0,
                        onion_urls: int | None = None):
    """A fake engine whose collect/fetch stages emit the engine's own trace kinds for onion engines and pages."""
    from cloud.reachability import onion_engine_names

    names = sorted(onion_engine_names())
    assert len(names) >= engines_ok + engines_failed, "the engine catalog has fewer onion engines than the test needs"
    onion_urls = onion_pages_ok if onion_urls is None else onion_urls
    called: list[str] = []

    async def fake(self, query, cli_depth, out_dir, timeout_s):
        def emit(**kw):
            self.on_engine_event(progress.ProgressEvent(**kw))

        def tr(stage, kind, **data):
            self.on_engine_event({"type": "trace", "schema": 2, "stage": stage, "kind": kind, "data": data})

        for i, st in enumerate(STAGES, 1):
            called.append(st)
            emit(type="stage", stage=progress.Stage(st), stage_index=i, status="start")
            if st == "collect":
                for n, name in enumerate(names[: engines_ok + engines_failed]):
                    tr("collect", "search.request", engine=name, query_index=0)
                    status = "ok" if n < engines_ok else ("timeout" if n % 2 else "error")
                    tr("collect", "search.result", engine=name, query_index=0, status=status, results=3 if status == "ok" else 0)
                tr("collect", "search.request", engine="github", query_index=0)  # a side source: not an onion engine
                tr("collect", "search.result", engine="github", query_index=0, status="ok", results=4)
                for u in range(onion_urls):
                    tr("collect", "url.found", url_id=f"o{u}", host="abcdefgh…wxyz[.]onion", depth=0)
                for u in range(clearnet_pages_ok):
                    tr("collect", "url.found", url_id=f"c{u}", host="github[.]com", depth=0)
            if st == "fetch":
                for u in range(onion_urls):
                    tr("fetch", "page.fetched", url_id=f"o{u}", outcome="ok" if u < onion_pages_ok else "timeout")
                for u in range(clearnet_pages_ok):
                    tr("fetch", "page.fetched", url_id=f"c{u}", outcome="ok")
            emit(type="stage", stage=progress.Stage(st), stage_index=i, status="end", duration_ms=10)
            await asyncio.sleep(0)
        emit(type="completed")

    run_mod.Run._run_engine = fake
    return called


def test_all_onion_engines_timing_out_and_no_onion_page_fails_as_sources_unreachable(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_with_sources(run, engines_ok=1, engines_failed=9, onion_pages_ok=0, onion_urls=1)
    assert run.run() == 0  # a clean, delivered failure: not a crash
    (t,) = world.terminals()
    assert (t["type"], t["reason"]) == ("failed", "sources_unreachable")
    assert t["stages_completed"] == STAGES[:4]  # decided at the end of fetch, before extract spends on the LLM
    assert world.died.is_set() and run.recorder.token_budget == 0  # the engine is stopped, no further LLM call
    assert "upload" not in world.order


def test_no_onion_url_at_all_is_decided_at_the_end_of_collect(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_with_sources(run, engines_ok=0, engines_failed=10, onion_pages_ok=0, onion_urls=0)
    assert run.run() == 0
    (t,) = world.terminals()
    assert t["reason"] == "sources_unreachable" and t["stages_completed"] == STAGES[:2]


def test_a_normal_run_completes(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_with_sources(run, engines_ok=8, engines_failed=2, onion_pages_ok=6, onion_urls=9)
    assert run.run() == 0
    (t,) = world.terminals()
    assert t["type"] == "completed" and "upload" in world.order and not run.unreachable.is_set()


def test_clearnet_only_pages_with_onion_engines_answering_complete(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_with_sources(run, engines_ok=9, engines_failed=1, onion_pages_ok=0, onion_urls=4, clearnet_pages_ok=3)
    assert run.run() == 0
    (t,) = world.terminals()
    assert t["type"] == "completed"


def test_some_onion_pages_save_a_run_whose_engines_mostly_failed(monkeypatch, world):
    run = make_run(monkeypatch, world)
    engine_with_sources(run, engines_ok=1, engines_failed=9, onion_pages_ok=2, onion_urls=3)
    assert run.run() == 0
    (t,) = world.terminals()
    assert t["type"] == "completed"


def test_tor_that_never_bootstraps_fails_as_sources_unreachable_before_the_engine(monkeypatch, world):
    from cloud import tor

    def no_tor(should_stop=lambda: False, **kw):
        raise tor.TorError("tor bootstrap failed after 3 attempts: tor bootstrap exceeded 60s")

    monkeypatch.setattr(tor, "start_tor_with_retry", no_tor)
    run = make_run(monkeypatch, world)
    called = engine_with_sources(run, engines_ok=10, engines_failed=0, onion_pages_ok=5)
    assert run.run() == 0
    (t,) = world.terminals()
    assert (t["type"], t["reason"]) == ("failed", "sources_unreachable") and called == []


def test_a_runner_failure_logs_its_class_stage_and_a_safe_message(monkeypatch, world, capsys):
    run = make_run(monkeypatch, world)
    engine_events(run)

    def boom(self, out_dir):
        self.phase = "finalize:validate"
        raise RuntimeError(
            "bundle failed schema validation: sources/0/excerpt: maxLength (lockbit leak site at "
            "http://abcdefghijklmnopabcdefghijklmnopabcdefghijklmnopabcd.onion/x and boss@victim.example)"
        )

    monkeypatch.setattr(run_mod.Run, "finalize_and_upload", boom)
    assert run.run() == 1
    err = capsys.readouterr().err
    line = next(x for x in err.splitlines() if "run failed" in x)
    assert "(RuntimeError) stage=finalize:validate" in line
    assert "bundle failed schema validation: sources/0/excerpt: maxLength" in line
    for leak in ("lockbit leak site", ".onion", "boss@victim", "http"):
        assert leak not in line, leak
    (t,) = world.terminals()
    assert t["reason"] == "error" and t["message"] == "runner error: RuntimeError at finalize:validate"


def test_safety_dropped_summary_reports_counts_only():
    from cloud.run import safety_dropped_summary

    assert safety_dropped_summary({"content_safety": {"page": 2, "url": 1, "title": 0, "entity": 0}}) == (
        "entity:0,page:2,title:0,url:1"
    )
    assert safety_dropped_summary({}) == "n/a"  # an engine before 2.1.1
    assert safety_dropped_summary(None) == "n/a"
    assert safety_dropped_summary({"content_safety": {"page": "x", "url": True}}) == "n/a"
