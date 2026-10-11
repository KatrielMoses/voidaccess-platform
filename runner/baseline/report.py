"""Compute E0 report tables from results.csv (metrics only; no page text)."""

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
STRAWMAN = {"quick": 10, "standard": 25, "deep": 60}
DEPTHS = ("quick", "standard", "deep")
METRICS = (
    ("duration_ms", "Duration (s)", 1000.0),
    ("tor_bootstrap_ms", "Tor bootstrap (s)", 1000.0),
    ("pages_count", "Pages", 1.0),
    ("entities_total", "Entities", 1.0),
    ("relationships_total", "Relationships", 1.0),
    ("llm_calls", "LLM calls", 1.0),
    ("llm_cost_usd", "LLM $", 1.0),
    ("compute_cost_usd", "Compute $", 1.0),
    ("total_cost_usd", "Total $", 1.0),
)


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    k = (len(ordered) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def load_rows() -> list[dict[str, str]]:
    """results.csv rows with compute/total cost filled in where the run did not record it.

    The parallel wave did not pass the Cloud Run rates into the tasks, so compute cost is
    derived here from the recorded duration, vCPU and memory with the rates verified on
    CLOUD_RUN_PRICING_URL on 2026-10-11 (same formula as compute.compute_cost_usd).
    """
    from baseline.constants import CLOUD_RUN_GIB_PER_S_USD, CLOUD_RUN_VCPU_PER_S_USD

    with (_PKG / "results.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        if r.get("status") not in ("ok", "completed") or not r.get("duration_ms"):
            continue
        if not r.get("compute_cost_usd"):
            secs = float(r["duration_ms"]) / 1000.0
            r["compute_cost_usd"] = str(
                float(r["vcpu"]) * secs * CLOUD_RUN_VCPU_PER_S_USD
                + float(r["memory_gib"]) * secs * CLOUD_RUN_GIB_PER_S_USD
            )
        r["total_cost_usd"] = str(float(r.get("llm_cost_usd") or 0.0) + float(r["compute_cost_usd"]))
    return rows


def _num(row: dict[str, str], key: str) -> float | None:
    try:
        return float(row[key]) if row.get(key) not in (None, "") else None
    except ValueError:
        return None


def stats(rows: list[dict[str, str]], key: str, scale: float) -> tuple[float, float, float] | None:
    vals = [v / scale for r in rows if (v := _num(r, key)) is not None]
    return (percentile(vals, 0.5), percentile(vals, 0.9), max(vals)) if vals else None


def fmt(triple: tuple[float, float, float] | None, money: bool = False) -> str:
    if triple is None:
        return "n/a"
    f = (lambda x: f"{x:.4f}") if money else (lambda x: f"{x:.1f}")
    return " / ".join(f(x) for x in triple)


def main_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """Default variant, successful runs (sequential 6 + wave)."""
    return [r for r in rows if r.get("variant") == "default" and r.get("status") == "completed" or
            (r.get("variant") == "default" and r.get("status") == "ok")]


def headline(rows: list[dict[str, str]]) -> str:
    out = ["| Metric (p50 / p90 / max) | quick | standard | deep |", "|---|---|---|---|"]
    by_depth = {d: [r for r in main_rows(rows) if r["depth"] == d] for d in DEPTHS}
    out.append("| n (successful cells) | " + " | ".join(str(len(by_depth[d])) for d in DEPTHS) + " |")
    for key, label, scale in METRICS:
        money = key.endswith("usd")
        out.append(f"| {label} | " + " | ".join(fmt(stats(by_depth[d], key, scale), money) for d in DEPTHS) + " |")
    return "\n".join(out)


def credits_table(rows: list[dict[str, str]]) -> str:
    out = ["| Depth | p90 total cost (¢) | credits = ceil(p90 / 0.0778¢) | PRD strawman |", "|---|---:|---:|---:|"]
    for d in DEPTHS:
        t = stats([r for r in main_rows(rows) if r["depth"] == d], "total_cost_usd", 0.01)
        if t is None:
            out.append(f"| {d} | n/a | n/a | {STRAWMAN[d]} |")
            continue
        out.append(f"| {d} | {t[1]:.3f} | {math.ceil(t[1] / MAX_COST_CENTS_PER_CREDIT)} | {STRAWMAN[d]} |")
    return "\n".join(out)


def stage_breakdown(rows: list[dict[str, str]], depth: str = "quick") -> str:
    sel = [r for r in main_rows(rows) if r["depth"] == depth]
    stage_keys = [k for k in (sel[0] if sel else {}) if k.startswith("stage_")]
    out = [f"| Stage ({depth}, n={len(sel)}) | p50 s | p90 s | max s | share of p50 total |", "|---|---:|---:|---:|---:|"]
    total_p50 = statistics.median([_num(r, "duration_ms") / 1000 for r in sel if _num(r, "duration_ms")]) if sel else 0
    for key in ["tor_bootstrap_ms", *stage_keys]:
        t = stats(sel, key, 1000.0)
        if t:
            out.append(f"| {key.removeprefix('stage_').removesuffix('_ms')} | {t[0]:.1f} | {t[1]:.1f} | {t[2]:.1f} | {100 * t[0] / total_p50:.0f}% |")
    return "\n".join(out)


def variant_compare(rows: list[dict[str, str]], variant: str, metrics: tuple[str, ...]) -> dict[str, Any]:
    base = {r["query_id"]: r for r in main_rows(rows) if r["depth"] == "standard"}
    other = [r for r in rows if r.get("variant") == variant and r.get("status") in ("ok", "completed")]
    pairs = [(base[r["query_id"]], r) for r in other if r["query_id"] in base]
    return {"n": len(other), "paired": len(pairs), "pairs": pairs}


def main() -> None:
    data = load_rows()
    print(headline(data), "\n")
    print(credits_table(data), "\n")
    print(stage_breakdown(data))


if __name__ == "__main__":
    main()
