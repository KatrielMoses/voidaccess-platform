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
        self.order.append("event:" + body["type"])
        return httpx.Response(200)

    def events(self) -> list[dict]:
        return [json.loads(r.content) for r in self.requests]

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


def engine_events(run, *, terminal="completed", reason=None, stages=STAGES, crash=None):
    """A fake engine: stage start/end for each stage, a refined event, counts, then its own terminal event."""

    async def fake(self, query, cli_depth, out_dir, timeout_s):
        emit = lambda **kw: self.on_engine_event(progress.ProgressEvent(**kw))  # noqa: E731
        for i, st in enumerate(stages, 1):
            stage = progress.Stage(st)
            emit(type="stage", stage=stage, stage_index=i, status="start")
            if st == "refine":
                emit(type="refined", refined_queries=["lockbit"])
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
    seqs = [int(r.headers["x-va-seq"]) for r in world.requests]
    assert seqs == list(range(1, len(seqs) + 1)), seqs


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
    engine_events(run)
    assert run.run() == 0
    (t,) = world.terminals()
    assert (t["type"], t["reason"]) == ("failed", "blocked_query") and t["stages_completed"] == []
    assert not world.tor_started
    assert not [e for e in world.events() if e["type"] == "stage"]


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
