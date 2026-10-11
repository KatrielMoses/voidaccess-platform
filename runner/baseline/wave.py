"""Single parallel wave: every remaining matrix cell as Cloud Run Job tasks.

Per-run LLM cost comes from recorded tokens (llm_usage.py); the shared key's usage
delta over the whole wave is only a cross-check (within WAVE_USAGE_CROSSCHECK_TOLERANCE).
Two executions are needed because CPU/memory are per execution: 1 vCPU/2 GiB cells and
2 vCPU/4 GiB cells. Both run concurrently.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from baseline.constants import (
    ARTIFACT_REPO,
    CLOUD_RUN_TASK_TIMEOUT_BACKSTOP_S,
    GCP_PROJECT,
    GCP_REGION,
    GCS_BASE_PREFIX,
    GCS_BUCKET,
    GCS_WAVE_PREFIX,
    IMAGE_NAME,
    JOB_NAME,
    MAX_OPENROUTER_USD,
    RUNNER_SERVICE_ACCOUNT,
    WAVE_MIN_LIMIT_REMAINING_USD,
    WAVE_PARALLELISM,
    WAVE_SPEND_POLL_INTERVAL_S,
    WAVE_USAGE_CROSSCHECK_TOLERANCE,
)
from baseline.matrix_runner import (
    Cell,
    _PKG,
    append_result_row,
    iter_matrix_cells,
    load_state,
    read_openrouter_key,
    resummarize,
    save_state,
    summarize_row,
    _RESULTS_CSV,
    _RESULTS_JSONL,
)
from baseline.openrouter import fetch_key_usage
from baseline.storage import download_result, upload_json

USAGE_SETTLE_POLL_S = 20.0
USAGE_SETTLE_MAX_WAIT_S = 240.0
DEPTH_ORDER = {"deep": 0, "standard": 1, "quick": 2}  # slowest first so they don't tail the wave


def _gcloud(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.setdefault("CLOUDSDK_ACTIVE_CONFIG_NAME", "voidaccess")
    proc = subprocess.run(["gcloud", *args], env=env, text=True, capture_output=True)
    if check and proc.returncode != 0:
        raise SystemExit(f"gcloud {' '.join(args[:4])} failed: {proc.stderr[-400:]}")
    return proc


def ingest_sequential_results(state: dict[str, Any]) -> int:
    """Keep results of cells that ran sequentially (not yet in state)."""
    from google.cloud import storage

    known = set(state.get("completed", {}).values()) | {
        v["run_id"] for v in state.get("failed", {}).values()
    }
    added = 0
    for blob in storage.Client().list_blobs(GCS_BUCKET, prefix=f"{GCS_BASE_PREFIX}/"):
        if not blob.name.endswith("/result.json"):
            continue
        run_id = blob.name.split("/")[-2]
        if run_id in known or "-" in run_id and run_id.startswith("w"):
            continue
        result = download_result(run_id)
        if not result or result.get("variant") != "default":
            continue
        m = result.get("metrics") or {}
        key = f"{result['query_id']}|{result['depth']}|default|cpu{int(m.get('vcpu', 1))}|mem{int(m.get('memory_gib', 2))}"
        if key in state.get("completed", {}):
            continue
        if m.get("exit_code") == 0:
            state.setdefault("completed", {})[key] = run_id
            state.setdefault("sequential", []).append(run_id)
            added += 1
    return added


def _cell_dict(cell: Cell) -> dict[str, Any]:
    return {
        "query_id": cell.query_id, "depth": cell.depth, "variant": cell.variant,
        "vcpu": cell.vcpu, "memory_gib": cell.memory_gib,
        "safety_bypass": cell.safety_bypass, "model_override": cell.model_override,
        "key": cell.key,
    }


def _execution_status(name: str) -> dict[str, Any]:
    out = _gcloud(["run", "jobs", "executions", "describe", name, f"--region={GCP_REGION}",
                   f"--project={GCP_PROJECT}", "--format=json"], check=False)
    try:
        return json.loads(out.stdout).get("status", {})
    except json.JSONDecodeError:
        return {}


def _launch(wave: str, cells: list[Cell], image: str, sha: str, vcpu: str, mem: str, parallelism: int) -> str:
    upload_json(f"{GCS_WAVE_PREFIX}/{wave}/cells.json", [_cell_dict(c) for c in cells])  # record only
    wave_cells = base64.b64encode(
        json.dumps([[c.query_id, c.depth, c.variant] for c in cells]).encode("utf-8")
    ).decode("ascii")
    _gcloud([
        "run", "jobs", "deploy", JOB_NAME, f"--project={GCP_PROJECT}", f"--region={GCP_REGION}",
        f"--image={image}", f"--service-account={RUNNER_SERVICE_ACCOUNT}",
        f"--task-timeout={CLOUD_RUN_TASK_TIMEOUT_BACKSTOP_S}s", f"--cpu={vcpu}", f"--memory={mem}Gi",
        "--max-retries=0", f"--tasks={len(cells)}", f"--parallelism={parallelism}",
        "--set-env-vars", f"ENGINE_GIT_SHA={sha}",
        "--set-secrets=OPENROUTER_API_KEY=openrouter-api-key:latest",
        "--command=python", "--args=-m,baseline.run_one",
    ])
    out = _gcloud(["run", "jobs", "execute", JOB_NAME, f"--project={GCP_PROJECT}", f"--region={GCP_REGION}",
                   "--async", "--update-env-vars",
                   f"WAVE_ID={wave},BASELINE_VCPU={vcpu},BASELINE_MEMORY_GIB={mem},WAVE_CELLS={wave_cells}", "--format=value(metadata.name)"])
    return out.stdout.strip().splitlines()[-1]


def main() -> None:
    sha = os.environ.get("ENGINE_GIT_SHA", "").strip()
    if not sha:
        sys.exit("ENGINE_GIT_SHA required")
    image = f"us-central1-docker.pkg.dev/{GCP_PROJECT}/{ARTIFACT_REPO}/{IMAGE_NAME}:{sha}"
    api_key = read_openrouter_key()

    state = load_state()
    ingest_sequential_results(state)
    save_state(state)
    remaining = [c for c in iter_matrix_cells() if c.key not in state.get("completed", {})]
    remaining.sort(key=lambda c: (DEPTH_ORDER[c.depth], c.variant, c.query_id))
    main_cells = [c for c in remaining if c.vcpu == "1"]
    cpu2_cells = [c for c in remaining if c.vcpu != "1"]
    print(f"remaining cells: {len(remaining)} (1 vCPU: {len(main_cells)}, 2 vCPU: {len(cpu2_cells)})", flush=True)

    before = fetch_key_usage(api_key)
    if before.limit_remaining is None or before.limit_remaining < WAVE_MIN_LIMIT_REMAINING_USD:
        sys.exit(f"limit_remaining {before.limit_remaining} < ${WAVE_MIN_LIMIT_REMAINING_USD}")
    print(f"key usage before: ${before.usage_usd:.4f}, remaining ${before.limit_remaining:.2f}", flush=True)

    wave = f"w{int(time.time())}"
    executions: dict[str, tuple[str, list[Cell]]] = {}
    executions[wave] = (_launch(wave, main_cells, image, sha, "1", "2", min(WAVE_PARALLELISM, len(main_cells))), main_cells)
    print(f"launched {executions[wave][0]} ({len(main_cells)} tasks)", flush=True)
    if cpu2_cells:
        wave2 = f"{wave}c2"
        executions[wave2] = (_launch(wave2, cpu2_cells, image, sha, "2", "4", len(cpu2_cells)), cpu2_cells)
        print(f"launched {executions[wave2][0]} ({len(cpu2_cells)} tasks, 2 vCPU/4 GiB)", flush=True)

    cancelled = False
    while True:
        usage = fetch_key_usage(api_key)
        spent = usage.usage_usd - before.usage_usd
        statuses = {w: _execution_status(name) for w, (name, _) in executions.items()}
        done = all(s.get("completionTime") for s in statuses.values())
        print(f"[{time.strftime('%H:%M:%S')}] spent ${spent:.3f} " + " ".join(
            f"{w}: run={s.get('runningCount', 0)} ok={s.get('succeededCount', 0)} fail={s.get('failedCount', 0)}"
            for w, s in statuses.items()), flush=True)
        if spent > MAX_OPENROUTER_USD and not cancelled:
            for name, _ in executions.values():
                _gcloud(["run", "jobs", "executions", "cancel", name, f"--region={GCP_REGION}",
                         f"--project={GCP_PROJECT}", "--quiet"], check=False)
            cancelled = True
            print("SPEND CAP: executions cancelled", flush=True)
        if done or cancelled:
            break
        time.sleep(WAVE_SPEND_POLL_INTERVAL_S)

    # Settle: wait until key usage stops moving.
    last, stable, deadline = -1.0, 0, time.monotonic() + USAGE_SETTLE_MAX_WAIT_S
    while time.monotonic() < deadline and stable < 2:
        time.sleep(USAGE_SETTLE_POLL_S)
        cur = fetch_key_usage(api_key).usage_usd
        stable = stable + 1 if abs(cur - last) < 1e-9 else 0
        last = cur
    delta = last - before.usage_usd

    est_total, counts = 0.0, {"ok": 0, "timeout": 0, "error": 0, "missing": 0}
    for w, (_, cells) in executions.items():
        for idx, cell in enumerate(cells):
            run_id = f"{w}-{idx:03d}"
            result = download_result(run_id)
            if not result:
                counts["missing"] += 1
                append_result_row({"run_id": run_id, "cell_key": cell.key, "query_id": cell.query_id,
                                   "depth": cell.depth, "variant": cell.variant, "status": "missing",
                                   "error": "no result.json (task timeout backstop or crash)"})
                state.setdefault("failed", {})[cell.key] = {"run_id": run_id, "status": "missing"}
                continue
            m = result.get("metrics") or {}
            st = m.get("status") or ("ok" if m.get("exit_code") == 0 else "error")
            counts[st] = counts.get(st, 0) + 1
            est_total += float(m.get("llm_cost_usd") or 0.0)
            row = summarize_row(result)
            row["cell_key"], row["status"] = cell.key, st
            append_result_row(row)
            if st == "ok":
                state.setdefault("completed", {})[cell.key] = run_id
            else:
                state.setdefault("failed", {})[cell.key] = {"run_id": run_id, "status": st}
    save_state(state)

    diff = (est_total - delta) / delta if delta else None
    summary = {
        "wave": wave, "executions": {w: n for w, (n, _) in executions.items()},
        "cells": counts, "est_llm_usd_from_tokens": est_total, "key_usage_delta_usd": delta,
        "relative_difference": diff,
        "within_tolerance": diff is not None and abs(diff) <= WAVE_USAGE_CROSSCHECK_TOLERANCE,
        "tolerance": WAVE_USAGE_CROSSCHECK_TOLERANCE,
    }
    (_PKG / "wave_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
