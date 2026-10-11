"""Generate docs/baseline/E0-REPORT.md from results.csv + GCS samples."""

from __future__ import annotations

import csv
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from baseline.constants import MAX_COST_CENTS_PER_CREDIT

_PKG = Path(__file__).resolve().parent
_CSV = _PKG / "results.csv"
_REPORT = _PKG.parent.parent / "docs" / "baseline" / "E0-REPORT.md"


def _percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return values[int(k)]
    return values[f] * (c - k) + values[c] * (k - f)


def _stats(rows: list[dict[str, Any]], field: str) -> dict[str, float | None]:
    vals = [float(r[field]) for r in rows if r.get(field) not in (None, "", "None")]
    if not vals:
        return {"p50": None, "p90": None, "max": None}
    return {
        "p50": statistics.median(vals),
        "p90": _percentile(vals, 0.9),
        "max": max(vals),
    }


def main() -> None:
    if not _CSV.exists():
        raise SystemExit(f"missing {_CSV}")

    rows = list(csv.DictReader(_CSV.open(encoding="utf-8")))
    by_depth: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("error"):
            continue
        if row.get("exit_code") not in (None, "", "0", 0):
            continue
        by_depth[row.get("depth") or "unknown"].append(row)

    lines = [
        "# E0 baseline report",
        "",
        "Auto-generated from `runner/baseline/results.csv`. Re-run `python -m baseline.report` after the matrix completes.",
        "",
        "## Headline cost table (USD)",
        "",
        "| Depth | p50 duration (s) | p90 duration (s) | p50 pages | p90 LLM $ | p90 compute $ | p90 total $ |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    credit_rows = []
    for depth in ("quick", "standard", "deep"):
        bucket = by_depth.get(depth, [])
        dur = _stats(bucket, "duration_ms")
        pages = _stats(bucket, "pages_count")
        llm = _stats(bucket, "llm_cost_usd")
        comp = _stats(bucket, "compute_cost_usd")
        tot = _stats(bucket, "total_cost_usd")
        lines.append(
            f"| {depth} | {(dur['p50'] or 0)/1000:.1f} | {(dur['p90'] or 0)/1000:.1f} | "
            f"{pages['p50'] or 0:.0f} | {llm['p90'] or 0:.4f} | {comp['p90'] or 0:.4f} | {tot['p90'] or 0:.4f} |"
        )
        if tot["p90"] is not None:
            cents = tot["p90"] * 100
            credits = math.ceil(cents / MAX_COST_CENTS_PER_CREDIT)
            credit_rows.append((depth, credits, cents))

    lines.extend(["", "## Recommended credits per depth", ""])
    for depth, credits, cents in credit_rows:
        lines.append(f"- **{depth}**: {credits} credits (p90 cost ≈ {cents:.3f}¢)")
    lines.append("")
    lines.append("PRD strawman comparison: quick 10 / standard 25 / deep 60.")
    lines.append("")
    failures = [r for r in rows if r.get("error") or r.get("exit_code") not in (None, "", "0")]
    lines.extend(["## Failures", "", f"Count: {len(failures)}", ""])
    for f in failures[:40]:
        lines.append(f"- {f.get('query_id')} {f.get('depth')} {f.get('variant')}: {f.get('error') or f.get('exit_code')}")

    _REPORT.parent.mkdir(parents=True, exist_ok=True)
    _REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(_REPORT)


if __name__ == "__main__":
    main()
