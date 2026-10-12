"""Collect E1B wave results after the fact (same cell ordering as wave_e1b).

Usage: python -m baseline.e1b_collect <wave_id_for_1/1_group> <wave_id_for_1/2_group>
"""

from __future__ import annotations

import json
import sys

from baseline.matrix_runner import summarize_row
from pathlib import Path

from baseline.storage import download_result

LOCAL_DIR = Path("/tmp/va-e1b-results")  # bulk-downloaded result.json files, named <run_id>.json


def _load(run_id: str):
    local = LOCAL_DIR / f"{run_id}.json"
    if local.exists() and local.stat().st_size:
        return json.loads(local.read_text())
    return download_result(run_id)
from baseline.wave import DEPTH_ORDER
from baseline.wave_e1b import RESULTS_E1B, build_cells


def main() -> None:
    wave_c, wave_ab = sys.argv[1], sys.argv[2]
    cells = build_cells(["A", "B", "C"])
    groups: dict[str, list] = {}
    for cell, res in cells:
        groups.setdefault(res, []).append(cell)
    for g in groups.values():
        g.sort(key=lambda c: (DEPTH_ORDER[c.depth], c.variant, c.query_id))
    plan = {wave_c: groups["1/1"], wave_ab: groups["1/2"]}
    counts: dict[str, int] = {}
    with RESULTS_E1B.open("w", encoding="utf-8") as fh:
        for w, group in plan.items():
            for idx, cell in enumerate(group):
                run_id = f"{w}-{idx:03d}"
                result = _load(run_id)
                if not result:
                    counts["missing"] = counts.get("missing", 0) + 1
                    fh.write(json.dumps({"run_id": run_id, "query_id": cell.query_id, "depth": cell.depth,
                                         "variant": cell.variant, "status": "missing"}) + "\n")
                    continue
                if result.get("query_id") != cell.query_id or result.get("variant") != cell.variant:
                    raise SystemExit(f"cell mismatch at {run_id}")
                m = result.get("metrics") or {}
                row = summarize_row(result)
                row["status"] = m.get("status") or ("ok" if m.get("exit_code") == 0 else "error")
                for k in ("stage_ms_events", "progress_counts", "progress_terminal", "tor_bootstrap_attempts",
                          "stagger_s", "summary_kind", "summary_len", "variant_env", "peak_rss_mb"):
                    row[k] = m.get(k)
                row["wave"] = w
                counts[row["status"]] = counts.get(row["status"], 0) + 1
                fh.write(json.dumps(row, default=str) + "\n")
    print(counts)


if __name__ == "__main__":
    main()
