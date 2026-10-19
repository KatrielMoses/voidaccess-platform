"""Canary: run one image's engine directly on a fixed query and print ONE summary line. No app, no callbacks, no
uploads, no user data.

Self-contained on purpose: `scripts/canary.sh` ships this file to the job base64-encoded through `python -c`, so the
same measurement runs inside ANY runner image, including ones built before this file existed (engine bf2213c and
2.1.0 both work). Usage inside an image:

    python -c "import base64;import sys;exec(base64.b64decode(sys.argv[1]))" <b64 of this file> <label> <query> <depth>

It applies the runner's cloud policy and depth preset, starts Tor with the image's own `cloud.tor`, runs the
engine's CLI pipeline (`_run_investigation`) with the LLM, and measures, the same way for every engine version:
  * Tor bootstrap ms and attempts (`cloud.tor.start_tor_with_retry`);
  * onion search engines: started (`search.search._fetch_engine`), finished ok / timed out / error (the engine's own
    `Engine <name> ...` warnings and `record_engine_attempt_async`), and cut by the search deadline (started, never
    finished);
  * onion URLs handed to the scraper (`Scraping N onion URLs` warning), and pages with content in the run database;
  * entities and relationships in the engine's JSON report; and, when the image has the runner's bundle code, whether
    the ResultBundle it would upload passes the schema and integrity checks.
The query is never printed (the label stands for it).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

# R2b-5 rule, mirrored for the report: what the production runner would decide for this run.
UNREACHABLE_ENGINE_FAIL_RATIO = 0.75


class _Tap:
    """Wraps a module logger: records warning messages, then delegates (immune to later level changes)."""

    def __init__(self, inner: Any, sink: list[str]):
        self._inner, self._sink = inner, sink

    def warning(self, msg: Any, *args: Any, **kw: Any) -> None:
        try:
            self._sink.append(str(msg) % args if args else str(msg))
        except Exception:
            pass
        self._inner.warning(msg, *args, **kw)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


def _engine_counts(started: set[str], finished: dict[str, bool], warnings: list[str]) -> dict[str, int]:
    timed_out, errored = set(), set()
    for w in warnings:
        m = re.match(r"Engine (.+?) (timed out|failed: .*|exception: .*)$", w)
        if m:
            (timed_out if m.group(2) == "timed out" else errored).add(m.group(1))
    ok = {n for n, success in finished.items() if success}
    cut = started - set(finished)
    return {
        "engines_started": len(started),
        "engines_ok": len(ok),
        "engines_timed_out": len(timed_out),
        "engines_error": len(errored - timed_out),
        "engines_cut_by_deadline": len(cut),
    }


def main(argv: list[str]) -> int:
    label, query, depth = argv[0], argv[1], argv[2]
    t0 = time.monotonic()
    os.chdir("/app/runner")
    sys.path.insert(0, "/app/runner")
    work = Path(tempfile.mkdtemp(prefix="va-canary-", dir="/tmp"))
    os.environ["HOME"] = str(work / "home")
    (work / "home").mkdir()
    db = work / "investigations.db"
    os.environ["VOIDACCESS_DB_PATH"] = str(db)
    os.environ["DATABASE_URL"] = f"sqlite:///{db.as_posix()}"

    from cloud import policy, tor

    policy.apply_cloud_policy_base()
    cli_depth = policy.apply_depth_preset(depth)
    policy.apply_cloud_profile()
    from voidaccess_cli import config as cli_config

    cfg = policy.build_cli_config(os.environ.get("OPENROUTER_API_KEY", "").strip())
    cli_config.save_config(cfg)
    cli_config.apply_env(cfg)
    policy.verify_policy()

    out: dict[str, Any] = {
        "canary": label,
        "depth": depth,
        "engine": os.environ.get("ENGINE_GIT_SHA", "?"),
        "runner": os.environ.get("RUNNER_GIT_SHA", "?"),
    }
    proc = None
    exit_code = 0
    try:
        try:
            proc, ms, attempts = tor.start_tor_with_retry()
            out.update(tor_bootstrap_ms=round(ms), tor_attempts=attempts, tor_ok=True)
        except Exception as exc:
            out.update(tor_ok=False, tor_error=type(exc).__name__)
            raise
        os.environ["TOR_PROXY_HOST"], os.environ["TOR_PROXY_PORT"] = "127.0.0.1", "9050"

        import search.search as ss
        import scraper.scrape as sc

        started: set[str] = set()
        finished: dict[str, bool] = {}
        warnings: list[str] = []
        real_fetch, real_record = ss._fetch_engine, ss.record_engine_attempt_async

        async def fetch_tap(engine, *a, **kw):
            started.add(str(engine.get("name")))
            return await real_fetch(engine, *a, **kw)

        def record_tap(name, success, *a, **kw):
            finished[str(name)] = finished.get(str(name), False) or bool(success)
            return real_record(name, success, *a, **kw)

        ss._fetch_engine, ss.record_engine_attempt_async = fetch_tap, record_tap
        ss.logger = _Tap(ss.logger, warnings)
        sc._logger = _Tap(sc._logger, warnings)

        terminal: list[str] = []
        from progress import CallbackSink

        def on_event(e: Any) -> None:
            d = e.to_dict() if hasattr(e, "to_dict") else dict(e)
            if d.get("type") in ("completed", "failed", "cancelled"):
                terminal.append(str(d.get("type")) + (f":{d['reason']}" if d.get("reason") else ""))

        from voidaccess_cli.commands.investigate import _run_investigation

        results = work / "results"
        results.mkdir()
        asyncio.run(
            _run_investigation(
                query=query, out_dir=results, model=policy.DEFAULT_MODEL, no_tor=False, no_llm=False,
                depth=cli_depth, fmt="json", quiet=True, sinks=[CallbackSink(on_event)],
            )
        )
        out["terminal"] = terminal[-1] if terminal else "none"
        out.update(_engine_counts(started, finished, warnings))
        scraped = [int(m.group(1)) for w in warnings for m in [re.match(r"Scraping (\d+) onion URLs", w)] if m]
        out["onion_urls_scraped"] = sum(scraped)
        with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as conn:
            onion, total = conn.execute(
                "SELECT COALESCE(SUM(CASE WHEN url LIKE '%.onion%' THEN 1 ELSE 0 END), 0), COUNT(*) FROM pages "
                "WHERE LENGTH(COALESCE(cleaned_text, '')) > 0"
            ).fetchone()
        out.update(onion_pages_with_content=int(onion), pages_with_content=int(total))
        files = sorted(results.glob("*.json"), key=lambda p: p.stat().st_mtime)
        cli = json.loads(files[-1].read_text(encoding="utf-8")) if files else {}
        out.update(entities=len(cli.get("entities") or []), relationships=len(cli.get("relationships") or []))
        out["bundle"] = _bundle_check(cli, db, depth)
        failed = out["engines_started"] - out["engines_ok"]
        out["would_be_sources_unreachable"] = bool(
            out["engines_started"] and failed / out["engines_started"] >= UNREACHABLE_ENGINE_FAIL_RATIO
            and out["onion_pages_with_content"] == 0
        )
    except Exception as exc:
        exit_code = 1
        out["error"] = type(exc).__name__
        if out.get("tor_ok") is False:
            out["would_be_sources_unreachable"] = True
    finally:
        tor.stop_tor(proc)
        out["wall_s"] = round(time.monotonic() - t0, 1)
        out["exit_code"] = exit_code
        print("CANARY " + json.dumps(out, sort_keys=True), flush=True)
    return exit_code


def _bundle_check(cli: dict[str, Any], db: Path, depth: str) -> str:
    """'ok', 'n/a' (image without the runner bundle code) or the first schema/integrity problems (paths only)."""
    try:
        from cloud import bundle as B
        from cloud.spec import schema_errors
    except Exception:
        return "n/a"
    try:
        built = B.build_bundle(B.BundleInputs(
            run_id="canary", query="canary", depth=depth, started_at="2026-01-01T00:00:00+00:00",
            completed_at="2026-01-01T00:10:00+00:00", engine_version=os.environ.get("ENGINE_GIT_SHA", "?"),
            metrics={}, cli_payload=cli, db_path=db,
        ))
        scrub = getattr(B, "scrub_bundle", None) or B.deep_scrub
        b = scrub(built.bundle, built.raw)
        b["metrics"] = {"duration_ms": 1.0, "tor_bootstrap_ms": 0.0, "stage_ms": {}, "llm_calls": 0,
                        "llm_tokens_in": 0, "llm_tokens_out": 0, "llm_cost_usd": 0.0, "pages_fetched": 0,
                        "bytes_fetched": 0, "enrichment_calls": {}, "peak_rss_mb": 0.0}
        problems = schema_errors("ResultBundle", b) or B.integrity_problems(b)
        return "ok" if not problems else "FAIL " + "; ".join(problems[:3])
    except Exception as exc:
        return f"FAIL {type(exc).__name__}"


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] not in ("--",) and len(args) == 4:  # python -c ... <b64> <label> <query> <depth>
        args = args[1:]
    code = main(args)
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)  # a scraper thread stuck on a dead circuit must not keep the job alive
