"""E1B measurement wave: variants A / B / C over the same 30 queries, one parallel wave.

A  speed profile, full sources            quick + standard   1 vCPU / 2 GiB
B  speed profile + cloud allowlist        quick + standard + deep   1 vCPU / 2 GiB
C  B at 1 vCPU / 1 GiB                    standard x 10 queries
Spend cap: E1B_MAX_OPENROUTER_USD of key usage, polled every WAVE_SPEND_POLL_INTERVAL_S.
Results go to results_e1b.jsonl (E0's results.jsonl is left alone).

Usage: ENGINE_GIT_SHA=<sha> python -m baseline.wave_e1b [--pilot N --variants A B]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from baseline.constants import (
    ARTIFACT_REPO,
    GCP_PROJECT,
    GCP_REGION,
    IMAGE_NAME,
    WAVE_PARALLELISM,
    WAVE_SPEND_POLL_INTERVAL_S,
)
from baseline.matrix_runner import Cell, read_openrouter_key, summarize_row
from baseline.openrouter import fetch_key_usage
from baseline.policy import load_queries
from baseline.storage import download_result
from baseline.wave import DEPTH_ORDER, _execution_status, _gcloud, _launch

E1B_MAX_OPENROUTER_USD = 5.0
E1B_MIN_LIMIT_REMAINING_USD = 5.5
C_QUERY_COUNT = 10
RESULTS_E1B = Path(__file__).resolve().parent / "results_e1b.jsonl"


def build_cells(variants: list[str], pilot: int = 0) -> list[tuple[Cell, str]]:
    qids = sorted(load_queries())
    if pilot:
        qids = qids[:pilot]
    plan = {
        "A": (["quick", "standard"], qids, "1", "2"),
        "B": (["quick", "standard", "deep"], qids, "1", "2"),
        "C": (["standard"], qids[:C_QUERY_COUNT], "1", "1"),
    }
    out: list[tuple[Cell, str]] = []
    for v in variants:
        depths, qs, cpu, mem = plan[v]
        for d in depths:
            for q in qs:
                out.append((Cell(q, d, v, cpu, mem, False, False), f"{cpu}/{mem}"))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--variants", nargs="*", default=["A", "B", "C"])
    ap.add_argument("--pilot", type=int, default=0, help="use only the first N queries")
    args = ap.parse_args()

    sha = os.environ.get("ENGINE_GIT_SHA", "").strip()
    if not sha:
        sys.exit("ENGINE_GIT_SHA required")
    image = f"us-central1-docker.pkg.dev/{GCP_PROJECT}/{ARTIFACT_REPO}/{IMAGE_NAME}:{sha}"
    api_key = read_openrouter_key()
    before = fetch_key_usage(api_key)
    if before.limit_remaining is None or before.limit_remaining < E1B_MIN_LIMIT_REMAINING_USD:
        sys.exit(f"limit_remaining {before.limit_remaining} < ${E1B_MIN_LIMIT_REMAINING_USD}")
    print(f"key usage before ${before.usage_usd:.4f}, remaining ${before.limit_remaining:.2f}", flush=True)

    cells = build_cells(args.variants, args.pilot)
    groups: dict[str, list[Cell]] = {}
    for cell, res in cells:
        groups.setdefault(res, []).append(cell)
    for g in groups.values():
        g.sort(key=lambda c: (DEPTH_ORDER[c.depth], c.variant, c.query_id))

    wave = f"e1b{int(time.time())}"
    executions: dict[str, tuple[str, list[Cell]]] = {}
    for i, (res, group) in enumerate(sorted(groups.items())):
        vcpu, mem = res.split("/")
        wid = wave if i == 0 else f"{wave}r{i}"
        name = _launch(wid, group, image, sha, vcpu, mem, min(WAVE_PARALLELISM, len(group)))
        executions[wid] = (name, group)
        print(f"launched {name} ({len(group)} tasks at {vcpu} vCPU / {mem} GiB)", flush=True)

    cancelled = False
    while True:
        usage = fetch_key_usage(api_key)
        spent = usage.usage_usd - before.usage_usd
        statuses = {w: _execution_status(n) for w, (n, _) in executions.items()}
        done = all(s.get("completionTime") for s in statuses.values())
        print(f"[{time.strftime('%H:%M:%S')}] spent ${spent:.3f} " + " ".join(
            f"{w}: run={s.get('runningCount', 0)} ok={s.get('succeededCount', 0)} fail={s.get('failedCount', 0)}"
            for w, s in statuses.items()), flush=True)
        if spent > E1B_MAX_OPENROUTER_USD and not cancelled:
            for n, _ in executions.values():
                _gcloud(["run", "jobs", "executions", "cancel", n, f"--region={GCP_REGION}",
                         f"--project={GCP_PROJECT}", "--quiet"], check=False)
            cancelled = True
            print("SPEND CAP: executions cancelled", flush=True)
        if done or cancelled:
            break
        time.sleep(WAVE_SPEND_POLL_INTERVAL_S)

    # Let key usage settle, then collect.
    last, stable, deadline = -1.0, 0, time.monotonic() + 240
    while time.monotonic() < deadline and stable < 2:
        time.sleep(20)
        cur = fetch_key_usage(api_key).usage_usd
        stable = stable + 1 if abs(cur - last) < 1e-9 else 0
        last = cur
    delta = last - before.usage_usd

    counts: dict[str, int] = {}
    with RESULTS_E1B.open("a", encoding="utf-8") as fh:
        for w, (_, group) in executions.items():
            for idx, cell in enumerate(group):
                run_id = f"{w}-{idx:03d}"
                result = download_result(run_id)
                if not result:
                    counts["missing"] = counts.get("missing", 0) + 1
                    fh.write(json.dumps({"run_id": run_id, "query_id": cell.query_id, "depth": cell.depth,
                                         "variant": cell.variant, "status": "missing"}) + "\n")
                    continue
                m = result.get("metrics") or {}
                row = summarize_row(result)
                row["status"] = m.get("status") or ("ok" if m.get("exit_code") == 0 else "error")
                for k in ("stage_ms_events", "progress_counts", "progress_terminal", "tor_bootstrap_attempts",
                          "stagger_s", "summary_kind", "summary_len", "variant_env", "peak_rss_mb"):
                    row[k] = m.get(k)
                row["wave"] = w
                counts[row["status"]] = counts.get(row["status"], 0) + 1
                fh.write(json.dumps(row, default=str) + "\n")
    summary: dict[str, Any] = {"wave": wave, "cells": counts, "key_usage_delta_usd": delta,
                               "executions": {w: n for w, (n, _) in executions.items()}}
    (Path(__file__).resolve().parent / f"wave_e1b_summary_{wave}.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
