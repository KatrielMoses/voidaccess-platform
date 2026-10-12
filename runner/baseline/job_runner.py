"""One Cloud Run Job execution = one baseline investigation."""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from baseline import __version__ as harness_version
from baseline.constants import (
    CELL_TIMEOUT_DEEP_S,
    CELL_TIMEOUT_QUICK_STANDARD_S,
    FLASH_COMPARE_MODEL,
)
from baseline.llm_usage import UsageRecorder, install_usage_recording
from baseline.compute import CloudRunRates, compute_cost_usd
from baseline.metrics import latest_investigation_id, aggregate_entity_counts, aggregate_relationship_counts, collect_sqlite_metrics
from baseline.openrouter import fetch_key_usage, wait_for_stable_usage
from baseline.policy import (
    apply_cloud_policy_base,
    apply_depth_preset,
    build_cli_config,
    render_bypass_state,
    set_safety_bypass_prompt,
    load_queries,
    apply_variant_env,
)
from baseline.progress_hook import StageCapture
from baseline.refusal import detect_refusals
from baseline.storage import upload_result
from baseline.tor_service import start_tor_with_retry, stop_tor


# Staggered task start: each task sleeps a random 0..STAGGER_MAX_S before it starts the
# clock or Tor, so a wide wave does not bootstrap 50 Tor clients in the same second.
STAGGER_MAX_S_DEFAULT = 60.0


def _apply_task_cell() -> None:
    """Parallel mode: map CLOUD_RUN_TASK_INDEX to a cell in WAVE_CELLS (base64 JSON list of
    [query_id, depth, variant]). The runner service account can write to the bucket but not
    read it, so the manifest travels in an env var. vCPU/memory come from the execution's
    BASELINE_VCPU / BASELINE_MEMORY_GIB env."""
    wave = os.environ.get("WAVE_ID", "").strip()
    index = os.environ.get("CLOUD_RUN_TASK_INDEX")
    if not wave or index is None:
        return
    import base64

    cells = json.loads(base64.b64decode(os.environ["WAVE_CELLS"]).decode("utf-8"))
    query_id, depth, variant = cells[int(index)]
    os.environ["RUN_ID"] = f"{wave}-{int(index):03d}"
    os.environ["QUERY_ID"] = query_id
    os.environ["DEPTH"] = depth
    os.environ["RUN_VARIANT"] = variant
    os.environ["SAFETY_BYPASS"] = "1" if variant == "bypass_compare" else "0"
    os.environ["MEASURE_LLM_COST"] = "0"
    if variant == "flash_compare":
        os.environ["MODEL_OVERRIDE"] = FLASH_COMPARE_MODEL
    else:
        os.environ.pop("MODEL_OVERRIDE", None)


def _peak_rss_mb() -> float:
    """Peak resident memory of this process (Linux ru_maxrss is in KiB)."""
    import resource

    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1)


def _configured_model(cfg: dict[str, Any]) -> str:
    from voidaccess.llm import DEFAULT_MODEL  # noqa: F401  (documented fallback)

    return str(cfg.get("llm", {}).get("model") or DEFAULT_MODEL)


def _cell_timeout_s(depth_name: str) -> float:
    return CELL_TIMEOUT_DEEP_S if depth_name == "deep" else CELL_TIMEOUT_QUICK_STANDARD_S


def _run_dir() -> Path:
    run_id = os.environ.get("RUN_ID") or str(uuid.uuid4())
    os.environ["RUN_ID"] = run_id
    base = Path(os.environ.get("BASELINE_WORK_DIR", "/tmp/voidaccess-baseline")) / run_id
    base.mkdir(parents=True, exist_ok=True)
    return base


def _latest_json(out_dir: Path) -> Path | None:
    files = sorted(out_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def _verify_bypass_state(expect_present: bool) -> bool:
    """Dry run: every rendered prompt path must match the expected bypass state."""
    state = render_bypass_state()
    ok = bool(state) and all(v is expect_present for v in state.values())
    print(f"bypass-dry-run: expect_present={expect_present} ok={ok} paths={state}")
    return ok


async def _execute_investigation(
    query: str,
    cli_depth: str,
    out_dir: Path,
    model: str | None,
    quiet: bool,
    timeout_s: float,
    sinks: list[Any] | None = None,
) -> int:
    from voidaccess_cli.commands.investigate import _run_investigation

    await asyncio.wait_for(
        _run_investigation(
            query=query,
            out_dir=out_dir,
            model=model,
            no_tor=False,
            no_llm=False,
            depth=cli_depth,
            fmt="json",
            quiet=quiet,
            sinks=sinks,
        ),
        timeout=timeout_s,
    )
    return 0


def main() -> None:
    stagger_s = 0.0
    if os.environ.get("WAVE_ID"):
        stagger_s = random.uniform(0.0, float(os.environ.get("STAGGER_MAX_S", STAGGER_MAX_S_DEFAULT)))
        time.sleep(stagger_s)
    t0 = time.monotonic()
    _apply_task_cell()
    exit_code = 0
    status = "ok"
    tor_proc = None
    tor_bootstrap_ms: float | None = None
    tor_attempts = 0
    run_base = _run_dir()
    run_id = os.environ["RUN_ID"]

    query_id = os.environ.get("QUERY_ID", "").strip()
    depth_name = os.environ.get("DEPTH", "standard").strip()
    variant = os.environ.get("RUN_VARIANT", "default")
    measure_cost = os.environ.get("MEASURE_LLM_COST", "1") == "1"
    bypass_on = os.environ.get("SAFETY_BYPASS", "0") == "1"

    queries = load_queries()
    if query_id not in queries:
        print(f"unknown QUERY_ID={query_id!r}", file=sys.stderr)
        sys.exit(2)
    query_text = queries[query_id]["query"]

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("OPENROUTER_API_KEY missing", file=sys.stderr)
        sys.exit(2)

    apply_cloud_policy_base()
    cli_depth = apply_depth_preset(depth_name)
    variant_env = apply_variant_env(variant)

    work = run_base
    db_path = work / "investigations.db"
    out_dir = work / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    os.environ["VOIDACCESS_DB_PATH"] = str(db_path)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"

    model_override = os.environ.get("MODEL_OVERRIDE", "").strip() or None
    cfg = build_cli_config(api_key, model=model_override)

    from voidaccess_cli import config as cli_config

    cli_config.save_config(cfg)
    cli_config.apply_env(cfg)

    set_safety_bypass_prompt(bypass_on)
    if not _verify_bypass_state(expect_present=bypass_on):
        print("safety-bypass switch did not take effect", file=sys.stderr)
        sys.exit(2)

    usage_recorder = UsageRecorder()
    install_usage_recording(usage_recorder)
    progress = StageCapture()

    from utils.content_safety import is_blocked_query

    blocked, reason = is_blocked_query(query_text)
    if blocked:
        print(f"query blocked: {reason}", file=sys.stderr)
        sys.exit(1)

    usage_before = None
    if measure_cost:
        usage_before = fetch_key_usage(api_key).usage_usd
        remaining = fetch_key_usage(api_key).limit_remaining
        if remaining is not None and remaining < 0.15:
            print("OpenRouter limit_remaining too low", file=sys.stderr)
            sys.exit(3)

    try:
        tor_proc, tor_bootstrap_ms, tor_attempts = start_tor_with_retry()
        os.environ["TOR_PROXY_HOST"] = "127.0.0.1"
        os.environ["TOR_PROXY_PORT"] = "9050"

        try:
            asyncio.run(
                _execute_investigation(
                    query_text, cli_depth, out_dir, model_override, True, _cell_timeout_s(depth_name),
                    sinks=[progress.sink()],
                )
            )
        except asyncio.TimeoutError:
            status = "timeout"
            exit_code = 124
            print(f"investigation timed out after {_cell_timeout_s(depth_name):.0f}s", file=sys.stderr)
        except SystemExit as exc:
            exit_code = int(exc.code) if isinstance(exc.code, int) else 1
            status = "error" if exit_code else "ok"
        except Exception as exc:
            print(f"investigation failed: {exc}", file=sys.stderr)
            exit_code = 1
            status = "error"
    finally:
        stop_tor(tor_proc)

    duration_ms = (time.monotonic() - t0) * 1000.0
    json_path = _latest_json(out_dir)
    cli_payload: dict[str, Any] = {}
    if json_path and json_path.exists():
        cli_payload = json.loads(json_path.read_text(encoding="utf-8"))

    inv_id = str(cli_payload.get("id") or latest_investigation_id(db_path))
    sqlite_metrics = (
        collect_sqlite_metrics(db_path, inv_id) if inv_id and db_path.exists() else {}
    )

    entities = cli_payload.get("entities") or []
    relationships = cli_payload.get("relationships") or []
    if not sqlite_metrics.get("entities_by_type") and entities:
        sqlite_metrics["entities_by_type"] = dict(aggregate_entity_counts(entities))
    if not sqlite_metrics.get("relationships_by_type") and relationships:
        sqlite_metrics["relationships_by_type"] = dict(aggregate_relationship_counts(relationships))

    refusal = detect_refusals(
        cli_payload,
        pages_count=int(sqlite_metrics.get("pages_count") or len(cli_payload.get("pages_scraped") or [])),
    )

    llm_usage = usage_recorder.summarize(model_override or cli_payload.get("model_used") or _configured_model(cfg))
    llm_cost_usd = llm_usage["est_cost_usd"]
    measured_delta_usd = None
    if measure_cost and usage_before is not None:
        measured_delta_usd = wait_for_stable_usage(api_key, usage_before)

    vcpu = float(os.environ.get("BASELINE_VCPU", "1"))
    memory_gib = float(os.environ.get("BASELINE_MEMORY_GIB", "2"))
    rates_json = os.environ.get("CLOUD_RUN_RATES_JSON", "")
    if not rates_json and os.environ.get("CLOUD_RUN_RATES_B64"):
        import base64

        rates_json = base64.b64decode(os.environ["CLOUD_RUN_RATES_B64"]).decode("utf-8")
    compute_usd = None
    if rates_json:
        raw = json.loads(rates_json)
        rates = CloudRunRates(
            url=raw["url"],
            vcpu_per_second_usd=float(raw["vcpu_per_second_usd"]),
            gib_per_second_usd=float(raw["gib_per_second_usd"]),
            fetched_at=raw["fetched_at"],
        )
        compute_usd = compute_cost_usd(duration_ms / 1000.0, vcpu, memory_gib, rates)

    result = {
        "run_id": run_id,
        "query_id": query_id,
        "depth": depth_name,
        "variant": variant,
        "harness_version": harness_version,
        "engine_version": os.environ.get("ENGINE_GIT_SHA", "unknown"),
        "model_used": cli_payload.get("model_used") or model_override,
        "llm_usage": llm_usage,
        "cli_payload": cli_payload,
        "metrics": {
            "duration_ms": duration_ms,
            "tor_bootstrap_ms": tor_bootstrap_ms,
            "exit_code": exit_code,
            **sqlite_metrics,
            **refusal,
            "status": status,
            "llm_cost_usd": llm_cost_usd,
            "llm_cost_measured_delta_usd": measured_delta_usd,
            "llm_calls_recorded": llm_usage["llm_calls"],
            "prompt_tokens": llm_usage["prompt_tokens"],
            "completion_tokens": llm_usage["completion_tokens"],
            "compute_cost_usd": compute_usd,
            "total_cost_usd": (
                (llm_cost_usd or 0.0) + (compute_usd or 0.0)
                if llm_cost_usd is not None or compute_usd is not None
                else None
            ),
            "vcpu": vcpu,
            "memory_gib": memory_gib,
            "stage_ms_events": progress.stage_ms,
            "progress_counts": progress.last_counts,
            "progress_terminal": progress.terminal,
            "progress_event_count": len(progress.events),
            "peak_rss_mb": _peak_rss_mb(),
            "tor_bootstrap_attempts": tor_attempts,
            "stagger_s": round(stagger_s, 1),
            "variant_env": variant_env,
            "summary_kind": cli_payload.get("summary_kind"),
            "summary_len": len(cli_payload.get("summary") or ""),
        },
    }

    if os.environ.get("LOCAL_RUN") == "1":
        out = work / "result.json"
        out.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
        print(out)
    else:
        uri = upload_result(run_id, result)
        print(uri)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
