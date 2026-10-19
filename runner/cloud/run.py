"""Entrypoint: `python -m cloud.run`. One Cloud Run Job execution = one investigation.

Flow
  1. read SPEC_URL, RUN_ID, DEADLINE_AT from the environment (the launcher passes nothing else; the query is
     never in the environment, the arguments or the logs);
  2. fetch the single-use RunSpec with an identity token for the app's audience, validate it, register the query
     and the callback secret with the log scrubber;
  3. a blocked query ends the run here (`failed: blocked_query`, before Tor or any collection);
  4. cloud policy, start jitter, Tor client (bootstrap retried), then the engine pipeline with a CallbackSink that
     forwards its progress events to the signed, retrying sender (engine terminal events are held back; the
     contract-v2 `trace` events, turned on with VOIDACCESS_TRACE_EVENTS=1, are forwarded best effort in batches);
  5. build the bundle, the exports and the page archive, upload them (the bundle last), and only then send
     `completed`.
Every run ends with exactly one terminal event, whatever happens: an engine crash, SIGTERM (cancel), the deadline
or the wall-clock cap. A thread per condition makes that hold even if the main thread is stuck in a blocking call.
"""

from __future__ import annotations

import asyncio
import json
import os
import resource
import signal
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from . import constants as C
from . import policy, scrub
from .archive import build_pages_archive
from .bundle import BundleInputs, build_bundle, integrity_problems, scrub_bundle
from .metrics import enrichment_calls, lower_only
from .reachability import Reachability
from .events import TERMINAL_TYPES, EventSender, utc_now_iso
from .exports import EXPORT_CONTENT_TYPE, EXPORT_FORMATS, build_exports, redact_local_db
from .identity import TokenSource
from .llm_budget import UsageRecorder, install_usage_recording
from .spec import SpecError, fetch_spec, parse_deadline, schema_errors
from .upload import UploadError, Uploader

EXIT_OK = 0
EXIT_CRASH = 1
EXIT_NO_SPEC = 3
STAGES = ("refine", "collect", "filter", "fetch", "extract", "enrich", "graph", "summarize")
WORK_ROOT = Path(os.environ.get("VA_WORK_DIR", "/tmp/va-run"))


def _peak_rss_mb() -> float:
    """Peak resident memory of this process and its children (the Tor client), MB (Linux ru_maxrss is KiB)."""
    own = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    child = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    scale = 1024.0 if sys.platform != "darwin" else 1024.0 * 1024.0
    return round((own + child) / scale, 1)


@dataclass
class RunState:
    t0: float
    started_at: str
    stage_ms: dict[str, int] = field(default_factory=dict)
    stages_completed: list[str] = field(default_factory=list)
    last_counts: dict[str, int] = field(default_factory=dict)
    engine_terminal: tuple[str, str | None] | None = None
    tor_bootstrap_ms: float = 0.0
    cli_payload: dict[str, Any] = field(default_factory=dict)
    export_errors: dict[str, str] = field(default_factory=dict)
    dropped_entities: dict[str, int] = field(default_factory=dict)


class Run:
    def __init__(self, env: Mapping[str, str] | None = None, tokens: TokenSource | None = None):
        self.env = dict(os.environ if env is None else env)
        self.tokens = tokens or TokenSource()
        self.state = RunState(t0=time.monotonic(), started_at=utc_now_iso())
        self.sender: EventSender | None = None
        self.spec: dict[str, Any] = {}
        self.recorder = UsageRecorder()
        self.model = self.env.get("VA_LLM_MODEL") or policy.DEFAULT_MODEL
        self.work: Path | None = None
        self.db_path: Path | None = None
        self._tor = None
        self._terminal_lock = threading.Lock()
        self._finished = threading.Event()
        self.terminal: tuple[str, str | None] | None = None
        self.delivered = False
        self.cancel_requested = threading.Event()
        self.exit_code = EXIT_OK
        self.phase = "start"  # where the run is, for a failure log line: setup, tor, engine:<stage>, finalize:<step>
        self.reach = Reachability()
        self.unreachable = threading.Event()

    # ---- terminal ---------------------------------------------------------------------------------------

    def build_metrics(self, live_prices: bool = True) -> dict[str, Any]:
        s = self.state
        totals = self.recorder.totals()
        try:
            cost = self.recorder.estimate_cost_usd(self.model, table=None if live_prices else {})
        except Exception:
            cost = 0.0
        pages, nbytes = 0, 0
        if self.db_path and self.db_path.exists():
            try:
                import sqlite3

                with sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True) as conn:
                    pages, nbytes = conn.execute(
                        "SELECT COUNT(*), COALESCE(SUM(COALESCE(byte_size, LENGTH(cleaned_text))), 0) FROM pages"
                    ).fetchone()
            except Exception:
                pass
        enrich = enrichment_calls(s.cli_payload.get("sources_used"), os.environ.get("VOIDACCESS_ENRICHMENT_SOURCES"))
        metrics: dict[str, Any] = {
            "duration_ms": round((time.monotonic() - s.t0) * 1000.0, 1),
            "tor_bootstrap_ms": round(s.tor_bootstrap_ms, 1),
            "stage_ms": {k: v for k, v in s.stage_ms.items() if k in STAGES},
            "llm_calls": totals["llm_calls"],
            "llm_tokens_in": totals["prompt_tokens"],
            "llm_tokens_out": totals["completion_tokens"],
            "llm_cost_usd": round(cost, 6),
            "pages_fetched": int(pages),
            "bytes_fetched": int(nbytes),
            "enrichment_calls": enrich,
            "peak_rss_mb": _peak_rss_mb(),
        }
        if s.export_errors:
            metrics["export_errors"] = dict(s.export_errors)
        if s.dropped_entities:
            metrics["dropped_entities"] = dict(s.dropped_entities)
        return metrics

    def finish(
        self,
        kind: str,
        reason: str | None = None,
        *,
        metrics: dict[str, Any] | None = None,
        message: str | None = None,
        flush_timeout: float = C.EVENT_FLUSH_TIMEOUT_S,
    ) -> bool:
        """Send the one terminal event. Only the first caller wins; returns True if this call sent it."""
        assert kind in TERMINAL_TYPES
        with self._terminal_lock:
            if self._finished.is_set():
                return False
            self._finished.set()
            self.terminal = (kind, reason)
        event: dict[str, Any] = {"type": kind}
        if reason:
            event["reason"] = reason
        if message:
            event["message"] = message
        if kind in ("failed", "cancelled"):
            event["stages_completed"] = list(self.state.stages_completed)
        if self.state.last_counts:
            event["counts"] = dict(self.state.last_counts)
        try:
            event["metrics"] = metrics or self.build_metrics(live_prices=(kind == "completed"))
        except Exception:
            pass
        if self.sender is not None:
            self.sender.emit(event)
            self.delivered = self.sender.close(flush_timeout) and self.sender.terminal_delivered
        if not self.delivered:
            self.exit_code = EXIT_CRASH
        elif kind == "failed" and reason == "error":
            self.exit_code = EXIT_CRASH
        return True

    # ---- watchdog threads ---------------------------------------------------------------------------------

    def _die(self) -> None:
        """Called from a watchdog thread once its terminal event has been sent: nothing else may run."""
        try:
            from .tor import stop_tor

            stop_tor(self._tor)
        finally:
            sys.stdout.flush()
            sys.stderr.flush()
            os._exit(self.exit_code)

    def _cancel_watch(self) -> None:
        self.cancel_requested.wait()
        if self.finish("cancelled", "cancelled", flush_timeout=C.CANCEL_FLUSH_TIMEOUT_S):
            self._die()

    def _deadline_watch(self, budget_s: float) -> None:
        if self._finished.wait(timeout=max(budget_s, 0.0)):
            return
        if self.finish("failed", "deadline"):
            self._die()

    def install_signals(self) -> None:
        try:
            signal.signal(signal.SIGTERM, lambda *_: self.cancel_requested.set())
        except ValueError:  # not the main thread (tests): the watcher can still be triggered directly
            pass
        threading.Thread(target=self._cancel_watch, name="va-cancel", daemon=True).start()

    # ---- unreachable sources (G5) ------------------------------------------------------------------------

    def sources_unreachable(self, where: str) -> None:
        """End the run as `failed: sources_unreachable` (the app refunds every failed run in full). No further LLM call
        is made: the token budget is closed before the terminal event is sent. Runs on the thread that decided."""
        if self.unreachable.is_set():
            return
        self.unreachable.set()
        self.recorder.token_budget = 0
        print(f"va-runner: sources unreachable {where} {json.dumps(self.reach.summary(), sort_keys=True)}", flush=True)
        if self.finish("failed", "sources_unreachable", message=C.UNREACHABLE_MESSAGE):
            self._die()

    # ---- progress ---------------------------------------------------------------------------------------

    def on_engine_event(self, event: Any) -> None:
        """CallbackSink target (runs on the engine emitter's worker thread). Never raises; it blocks only to end the run
        as `sources_unreachable` (the engine must not go on spending)."""
        try:
            d = event.to_dict() if hasattr(event, "to_dict") else dict(event)
            etype = d.get("type")
            if etype == "trace":  # contract v2: best effort, batched by the sender; never part of the run's state
                self.reach.observe(d)
                if self.sender is not None:
                    self.sender.emit(d)
                return
            if etype in TERMINAL_TYPES:
                self.state.engine_terminal = (etype, d.get("reason"))  # the runner decides what to send
                return
            if etype == "refined":  # the refined queries are the user's query in other words: keep them out of logs
                for q in d.get("refined_queries") or []:
                    scrub.register(str(q))
            if etype == "stage" and d.get("status") == "start" and d.get("stage"):
                self.phase = f"engine:{d['stage']}"
            if etype == "stage" and d.get("status") in ("end", "skipped") and d.get("stage"):
                if d["stage"] not in self.state.stages_completed:
                    self.state.stages_completed.append(d["stage"])
                if d.get("duration_ms") is not None:
                    self.state.stage_ms[d["stage"]] = int(d["duration_ms"])
            if d.get("counts"):
                self.state.last_counts = dict(d["counts"])
            if self.sender is not None:
                self.sender.emit(d)
            if etype == "stage" and d.get("status") in ("end", "skipped") and self.reach.check(str(d.get("stage"))):
                self.sources_unreachable(f"after {d['stage']}")
        except Exception:
            pass

    # ---- the engine ---------------------------------------------------------------------------------------

    def _setup_engine_env(self, query: str, depth: str) -> str:
        assert self.work is not None
        home = self.work / "home"
        home.mkdir(parents=True, exist_ok=True)
        os.environ["HOME"] = str(home)
        self.db_path = self.work / "investigations.db"
        os.environ["VOIDACCESS_DB_PATH"] = str(self.db_path)
        os.environ["DATABASE_URL"] = f"sqlite:///{self.db_path.as_posix()}"
        policy.apply_cloud_policy_base()
        cli_depth = policy.apply_depth_preset(depth)
        policy.apply_cloud_profile()
        # Contract v2: the engine emits `trace` events (live run detail) only when asked to; the cloud always asks.
        os.environ["VOIDACCESS_TRACE_EVENTS"] = "1"
        return cli_depth

    async def _run_engine(self, query: str, cli_depth: str, out_dir: Path, timeout_s: float) -> None:
        from voidaccess_cli.commands.investigate import _run_investigation
        from progress import CallbackSink

        await asyncio.wait_for(
            _run_investigation(
                query=query,
                out_dir=out_dir,
                model=self.model,
                no_tor=False,
                no_llm=False,
                depth=cli_depth,
                fmt="json",
                quiet=True,
                sinks=[CallbackSink(self.on_engine_event)],
            ),
            timeout=timeout_s,
        )

    def _prepare_engine(self, api_key: str) -> None:
        from voidaccess_cli import config as cli_config

        cfg = policy.build_cli_config(api_key, model=self.model)
        cli_config.save_config(cfg)
        cli_config.apply_env(cfg)
        policy.verify_policy()
        self.recorder.token_budget = lower_only(
            C.LLM_TOKEN_BUDGET[self.spec["depth"]], self.env.get("VA_LLM_TOKEN_BUDGET")
        )
        install_usage_recording(self.recorder)

    # ---- finalize ---------------------------------------------------------------------------------------

    def _latest_cli_json(self, out_dir: Path) -> dict[str, Any]:
        files = sorted(out_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        return json.loads(files[0].read_text(encoding="utf-8")) if files else {}

    def finalize_and_upload(self, out_dir: Path) -> dict[str, Any]:
        """Build everything, upload it (the bundle last). Returns the bundle's metrics."""
        assert self.db_path is not None
        s = self.state
        self.phase = "finalize:read_result"
        s.cli_payload = self._latest_cli_json(out_dir)
        if not s.cli_payload:
            raise RuntimeError("the engine wrote no result file")
        investigation_id = str(s.cli_payload.get("id") or "")
        urls = self.spec["artifact_put_urls"]
        uploader = Uploader(self.tokens, self.spec["callback_url"])

        self.phase = "finalize:build_bundle"
        built = build_bundle(
            BundleInputs(
                run_id=self.spec["run_id"],
                query=self.spec["query"],
                depth=self.spec["depth"],
                started_at=s.started_at,
                completed_at=utc_now_iso(),
                engine_version=self.env.get("ENGINE_GIT_SHA", "unknown"),
                metrics={},
                cli_payload=s.cli_payload,
                db_path=self.db_path,
            )
        )
        s.dropped_entities = built.dropped_entities

        # Exports run on the database after its sensitive rows were rewritten to their masked forms.
        self.phase = "finalize:exports"
        redact_local_db(self.db_path, built.raw)
        wanted = tuple(f for f in EXPORT_FORMATS if f in urls.get("exports", {}))
        exports, s.export_errors = build_exports(
            investigation_id, self.spec["run_id"], self.spec["query"], built.raw, wanted
        )
        for fmt, data in exports.items():
            try:
                uploader.put(urls["exports"][fmt], data, EXPORT_CONTENT_TYPE[fmt])
            except UploadError:
                s.export_errors[fmt] = "upload_failed"
        if urls.get("pages"):
            self.phase = "finalize:pages"
            try:
                archive = build_pages_archive(
                    {pid: built.raw.replace_pairs(t) for pid, t in built.sanitized_pages.items()}, built.page_rows
                )
                uploader.put(urls["pages"], archive, "application/gzip")
            except UploadError:
                s.export_errors["pages"] = "upload_failed"

        self.phase = "finalize:validate"
        metrics = self.build_metrics(live_prices=True)
        bundle = scrub_bundle(built.bundle, built.raw)
        bundle["metrics"] = metrics
        bundle["completed_at"] = utc_now_iso()
        problems = schema_errors("ResultBundle", bundle) or integrity_problems(bundle)
        if problems:
            raise RuntimeError("bundle failed schema validation: " + "; ".join(problems))
        self.phase = "finalize:upload_bundle"
        uploader.put(urls["bundle"], json.dumps(bundle, ensure_ascii=False).encode("utf-8"), "application/json")
        return metrics

    # ---- the whole run ------------------------------------------------------------------------------------

    def run(self) -> int:
        env = self.env
        spec_url, run_id = env.get("SPEC_URL", ""), env.get("RUN_ID", "")
        if not spec_url or not run_id:
            print("va-runner: SPEC_URL and RUN_ID are required", file=sys.stderr)
            return EXIT_NO_SPEC
        scrub.install_stream_scrubbers()
        self.install_signals()
        api_key = env.get("OPENROUTER_API_KEY", "").strip()
        scrub.register(api_key)
        try:
            self.spec = fetch_spec(spec_url, self.tokens, expected_run_id=run_id)
        except SpecError as exc:
            print(f"va-runner: {exc}", file=sys.stderr)
            return EXIT_NO_SPEC
        except Exception as exc:
            print(f"va-runner: spec fetch failed ({type(exc).__name__})", file=sys.stderr)
            return EXIT_NO_SPEC
        spec = self.spec
        scrub.register(spec["query"])
        scrub.register(spec["callback_secret"])
        self.sender = EventSender(spec["callback_url"], spec["callback_secret"], run_id, self.tokens, redact=[api_key])

        deadline = parse_deadline(spec["deadline_at"])
        if env.get("DEADLINE_AT"):
            try:
                deadline = min(deadline, parse_deadline(env["DEADLINE_AT"]))
            except ValueError:
                pass
        remaining = (deadline - datetime.now(timezone.utc)).total_seconds()
        cap = lower_only(C.WALL_CLOCK_CAP_S[spec["depth"]], env.get("VA_WALL_CLOCK_CAP_S"))
        budget = min(cap - (time.monotonic() - self.state.t0), remaining)
        if budget <= 0:
            self.finish("failed", "deadline", message="deadline already passed")
            return self.exit_code
        threading.Thread(target=self._deadline_watch, args=(budget,), name="va-deadline", daemon=True).start()

        self.sender.emit({"type": "counts", "message": "starting"})  # first sign of life: launching -> running
        self.work = WORK_ROOT / run_id
        self.work.mkdir(parents=True, exist_ok=True)
        out_dir = self.work / "results"
        out_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.phase = "setup"
            cli_depth = self._setup_engine_env(spec["query"], spec["depth"])
            from utils.content_safety import is_blocked_query

            blocked, _ = is_blocked_query(spec["query"])
            if blocked:  # G9: before any collection
                self.finish("failed", "blocked_query", message="query blocked by content policy")
                return self.exit_code
            if not api_key:
                raise RuntimeError("OPENROUTER_API_KEY is not set")
            self._prepare_engine(api_key)

            from . import tor

            if self.cancel_requested.wait(tor.start_jitter_s()):
                return self.exit_code if self._finished.is_set() else EXIT_OK
            self.phase = "tor"
            try:
                self._tor, self.state.tor_bootstrap_ms, _ = tor.start_tor_with_retry(self.cancel_requested.is_set)
            except tor.TorError as exc:
                if self.cancel_requested.is_set():
                    raise
                print(f"va-runner: sources unreachable: {exc}", flush=True)  # TorError text is ours: no query or URL
                self.unreachable.set()
                self.finish("failed", "sources_unreachable", message=C.UNREACHABLE_MESSAGE)
                return self.exit_code
            os.environ["TOR_PROXY_HOST"], os.environ["TOR_PROXY_PORT"] = "127.0.0.1", "9050"

            engine_timeout = max(budget - (time.monotonic() - self.state.t0) - C.FINALIZE_RESERVE_S, 5.0)
            try:
                asyncio.run(self._run_engine(spec["query"], cli_depth, out_dir, engine_timeout))
            except asyncio.TimeoutError:
                self.finish("failed", "deadline")
                return self.exit_code
            except Exception:
                if not self.unreachable.is_set():
                    raise
            if self.unreachable.is_set():  # decided mid-run; an LLM call refused after it may have ended the engine
                self.finish("failed", "sources_unreachable", message=C.UNREACHABLE_MESSAGE)
                return self.exit_code
            term = self.state.engine_terminal
            if term is None:
                raise RuntimeError("the engine ended without a terminal event")
            if term[0] == "failed":
                self.finish("failed", term[1] if term[1] in ("no_results", "blocked_query", "deadline") else "error")
                return self.exit_code
            if term[0] == "cancelled":
                self.finish("cancelled", "cancelled")
                return self.exit_code

            metrics = self.finalize_and_upload(out_dir)
            self.finish("completed", metrics=metrics)
        except BaseException as exc:  # a crash in the engine or the runner: still exactly one terminal event
            if not isinstance(exc, SystemExit):
                print(
                    f"va-runner: run failed ({type(exc).__name__}) stage={self.phase} "
                    f"message={scrub.safe_exception_message(exc)}",
                    file=sys.stderr, flush=True,
                )
            if self.unreachable.is_set():
                self.finish("failed", "sources_unreachable", message=C.UNREACHABLE_MESSAGE)
            else:
                self.finish("failed", "error", message=f"runner error: {type(exc).__name__} at {self.phase}")
        finally:
            from .tor import stop_tor

            stop_tor(self._tor)
        print(
            f"va-runner: terminal={self.terminal} delivered={self.delivered} "
            f"peak_rss_mb={_peak_rss_mb()} events_sent={self.sender.sent if self.sender else 0} "
            f"counts_dropped={self.sender.dropped_counts if self.sender else 0} "
            f"traces_sent={self.sender.traces_sent if self.sender else 0} "
            f"traces_lost={self._traces_lost()}",
            flush=True,
        )
        return self.exit_code


    def _traces_lost(self) -> int:
        s = self.sender
        return (s.dropped_traces + s.evicted_traces + s.failed_traces) if s else 0


def main() -> None:
    code = Run().run()
    # Leave without waiting for non-daemon threads: a scraper thread stuck on a dead Tor circuit must not keep
    # a finished run (and its Cloud Run billing) alive.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)


if __name__ == "__main__":
    main()
