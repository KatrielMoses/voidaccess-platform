"""Build the E1B report tables from results.jsonl (E0) and results_e1b.jsonl (E1B).

Prints markdown to stdout. Metrics and counts only.
Usage: python -m baseline.e1b_report > /tmp/e1b_tables.md
"""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from baseline.constants import CLOUD_RUN_GIB_PER_S_USD, CLOUD_RUN_VCPU_PER_S_USD, MAX_COST_CENTS_PER_CREDIT

PKG = Path(__file__).resolve().parent
DEPTHS = {"quick": "quick", "standard": "standard", "deep": "deep"}
STAGES = ("refine", "collect", "filter", "fetch", "extract", "enrich", "graph", "summarize")
LLM_CALIBRATION = 0.80  # E0: billed LLM cost about 0.80 x list-price token estimate


def load(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def pct(values: Iterable[float], p: float) -> float | None:
    v = sorted(x for x in values if x is not None)
    if not v:
        return None
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def fmt(x: float | None, nd: int = 1) -> str:
    return "n/a" if x is None else f"{x:.{nd}f}"


def trio(values: list[float | None], nd: int = 1, scale: float = 1.0) -> str:
    vs = [v * scale for v in values if v is not None]
    return f"{fmt(pct(vs, .5), nd)} / {fmt(pct(vs, .9), nd)} / {fmt(max(vs) if vs else None, nd)}"


def compute_usd(row: dict[str, Any]) -> float | None:
    d = row.get("duration_ms")
    if d is None:
        return None
    s = d / 1000.0
    return s * float(row.get("vcpu") or 1) * CLOUD_RUN_VCPU_PER_S_USD + s * float(row.get("memory_gib") or 2) * CLOUD_RUN_GIB_PER_S_USD


def total_usd(row: dict[str, Any]) -> float | None:
    c = compute_usd(row)
    l = row.get("llm_cost_usd")
    if c is None and l is None:
        return None
    return (c or 0.0) + (l or 0.0)


def ok(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in rows if r.get("status") in ("ok", "completed") and r.get("exit_code") in (0, None)]


def e0_rows() -> dict[tuple[str, str], dict[str, Any]]:
    out = {}
    for r in load(PKG / "results.jsonl"):
        if r.get("variant") == "default" and r.get("status") in ("completed", "ok") and float(r.get("memory_gib") or 2) == 2 and float(r.get("vcpu") or 1) == 1:
            out[(r["query_id"], r["depth"])] = r
    return out


def headline(rows: list[dict[str, Any]], title: str) -> str:
    lines = [f"### {title}", "", "| Metric (p50 / p90 / max) | quick | standard | deep |", "|---|---|---|---|"]
    by = {d: [r for r in rows if r["depth"] == d] for d in DEPTHS}

    def row(label: str, f, nd=1, scale=1.0):
        cells = [trio([f(r) for r in by[d]], nd, scale) if by[d] else "n/a" for d in DEPTHS]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")

    lines.append("| n (successful cells) | " + " | ".join(str(len(by[d])) for d in DEPTHS) + " |")
    row("Duration (s)", lambda r: r.get("duration_ms"), 1, 1 / 1000)
    row("Tor bootstrap (s)", lambda r: r.get("tor_bootstrap_ms"), 1, 1 / 1000)
    row("Pages", lambda r: r.get("pages_count"), 1)
    row("Entities", lambda r: r.get("entities_total"), 1)
    row("Relationships", lambda r: r.get("relationships_total"), 1)
    row("LLM calls", lambda r: r.get("llm_calls"), 1)
    row("LLM $", lambda r: r.get("llm_cost_usd"), 4)
    row("Compute $", compute_usd, 4)
    row("Total $", total_usd, 4)
    return "\n".join(lines)


def over_5min(rows: list[dict[str, Any]]) -> str:
    out = []
    for d in DEPTHS:
        rs = [r for r in rows if r["depth"] == d and r.get("duration_ms")]
        if rs:
            out.append(f"{d}: {sum(r['duration_ms'] > 300_000 for r in rs)}/{len(rs)}")
    return ", ".join(out)


def stage_table(rows: list[dict[str, Any]], depth: str, title: str) -> str:
    rs = [r for r in rows if r["depth"] == depth and r.get("stage_ms_events")]
    if not rs:
        return f"### {title}\n\nn/a"
    tot = pct([r["duration_ms"] / 1000 for r in rs], .5) or 1
    lines = [f"### {title} (n={len(rs)})", "", "| Stage | p50 s | p90 s | max s | share of p50 total |", "|---|---:|---:|---:|---:|"]
    for st in STAGES:
        vs = [r["stage_ms_events"].get(st) for r in rs if r["stage_ms_events"].get(st) is not None]
        p50 = pct([v / 1000 for v in vs], .5)
        lines.append(f"| {st} | {fmt(p50)} | {fmt(pct([v / 1000 for v in vs], .9))} | {fmt(max(vs) / 1000 if vs else None)} | {fmt(100 * p50 / tot if p50 is not None else None, 0)}% |")
    boot = pct([r["tor_bootstrap_ms"] / 1000 for r in rs if r.get("tor_bootstrap_ms")], .5)
    lines.append(f"| tor_bootstrap (outside stages) | {fmt(boot)} | | | |")
    return "\n".join(lines)


def paired(a_rows, base: dict[tuple[str, str], dict[str, Any]], key: str) -> dict[str, list[float]]:
    out: dict[str, list[float]] = defaultdict(list)
    for r in a_rows:
        b = base.get((r["query_id"], r["depth"]))
        if b and b.get(key):
            out[r["depth"]].append((r.get(key) or 0) / b[key])
    return out


def ratio_table(rows, base, title: str) -> str:
    lines = [f"### {title}", "", "| Depth | n pairs | pages ratio (median) | entities ratio (median) | relationships ratio (median) |", "|---|---:|---:|---:|---:|"]
    allp, alle = [], []
    for d in DEPTHS:
        rd = [r for r in rows if r["depth"] == d]
        p, e, rel = paired(rd, base, "pages_count"), paired(rd, base, "entities_total"), paired(rd, base, "relationships_total")
        if not p.get(d):
            continue
        allp += p[d]
        alle += e[d]
        lines.append(f"| {d} | {len(p[d])} | {fmt(statistics.median(p[d]), 2)} | {fmt(statistics.median(e[d]) if e[d] else None, 2)} | {fmt(statistics.median(rel[d]) if rel[d] else None, 2)} |")
    if allp:
        lines.append(f"| all | {len(allp)} | {fmt(statistics.median(allp), 2)} | {fmt(statistics.median(alle), 2)} | |")
    return "\n".join(lines)


def loss_by_type(a_rows, b_rows, field: str, title: str) -> str:
    a = {(r["query_id"], r["depth"]): json.loads(r[field] or "{}") if isinstance(r.get(field), str) else (r.get(field) or {}) for r in a_rows}
    b = {(r["query_id"], r["depth"]): json.loads(r[field] or "{}") if isinstance(r.get(field), str) else (r.get(field) or {}) for r in b_rows}
    keys = set(a) & set(b)
    ta, tb = defaultdict(int), defaultdict(int)
    for k in keys:
        for t, c in a[k].items():
            ta[t] += c
        for t, c in b[k].items():
            tb[t] += c
    lines = [f"### {title} ({len(keys)} paired cells)", "", "| Type | A total | B total | lost | loss % |", "|---|---:|---:|---:|---:|"]
    for t in sorted(ta, key=lambda t: -(ta[t] - tb.get(t, 0))):
        lost = ta[t] - tb.get(t, 0)
        if lost or ta[t] >= 20:
            lines.append(f"| {t} | {ta[t]} | {tb.get(t, 0)} | {lost} | {100 * lost / ta[t]:.0f}% |")
    return "\n".join(lines)


def credits_table(rows: list[dict[str, Any]], title: str) -> str:
    lines = [f"### {title}", "", "| Depth | p50 total ¢ | p90 total ¢ | max ¢ | credits (p90 / 0.0778¢) | calibrated credits (LLM x0.80) |", "|---|---:|---:|---:|---:|---:|"]
    for d in DEPTHS:
        rs = [r for r in rows if r["depth"] == d]
        if not rs:
            continue
        tot = [100 * total_usd(r) for r in rs if total_usd(r) is not None]
        cal = [100 * ((compute_usd(r) or 0) + LLM_CALIBRATION * (r.get("llm_cost_usd") or 0)) for r in rs]
        lines.append(f"| {d} | {fmt(pct(tot, .5), 2)} | {fmt(pct(tot, .9), 2)} | {fmt(max(tot), 2)} | {fmt(pct(tot, .9) / MAX_COST_CENTS_PER_CREDIT, 0)} | {fmt(pct(cal, .9) / MAX_COST_CENTS_PER_CREDIT, 0)} |")
    return "\n".join(lines)


def main() -> None:
    import sys

    e0 = e0_rows()
    fname = sys.argv[1] if len(sys.argv) > 1 else "results_e1b.jsonl"
    vs = sys.argv[2].split(",") if len(sys.argv) > 2 else ["A", "B", "C"]
    all_rows = load(PKG / fname)
    if "confirm" in fname:  # A2/B2 are A/B re-run with the relaxed profile
        for r in all_rows:
            r["variant"] = str(r.get("variant", "")).rstrip("2")
        vs = ["A", "B", "C"]
    by_v = {v: [r for r in all_rows if r.get("variant") == v] for v in vs}
    good = {v: ok(rs) for v, rs in by_v.items()}
    e0_list = list(e0.values())
    print("## E0 reference (default, 1 vCPU / 2 GiB)\n")
    print(headline(e0_list, "E0 baseline") + f"\n\nOver 5 min: {over_5min(e0_list)}\n")
    for v in "AB":
        print(headline(good[v], f"Variant {v}") + f"\n\nOver 5 min: {over_5min(good[v])}\n")
        print(f"Cells: {len(by_v[v])} launched, {len(good[v])} succeeded, statuses: " + str(dict(__import__('collections').Counter(r.get('status') for r in by_v[v]))) + "\n")
    print(headline(good["C"], "Variant C (1 vCPU / 1 GiB, B config)") + "\n")
    for v in "AB":
        for d in ("quick", "standard"):
            print(stage_table(good[v], d, f"Stage breakdown, variant {v} {d}") + "\n")
    print(ratio_table(good["A"], e0, "Quality ratios, A vs E0 (paired per query and depth)") + "\n")
    print(ratio_table(good["B"], e0, "Quality ratios, B vs E0 (paired)") + "\n")
    print(loss_by_type(good["A"], good["B"], "entities_by_type", "Entity loss from the allowlist, B vs A, by type") + "\n")
    print(loss_by_type(good["A"], good["B"], "relationships_by_type", "Edge loss from the allowlist, B vs A, by relationship type") + "\n")
    # summaries
    print("### Summaries\n")
    for v in "ABC":
        rs = by_v[v]
        withpages = [r for r in good[v] if (r.get("pages_count") or 0) > 0]
        empty = [r for r in withpages if not (r.get("summary_len") or 0)]
        kinds = dict(__import__("collections").Counter(r.get("summary_kind") for r in withpages))
        print(f"- {v}: {len(withpages)} runs with pages, {len(empty)} with an empty summary, kinds {kinds}")
    print("\n### Memory (variant C vs B standard)\n")
    c, b = good["C"], [r for r in good["B"] if r["depth"] == "standard"]
    print(f"- C: {len(c)}/{len(by_v['C'])} succeeded; peak RSS MB p50/max {trio([r.get('peak_rss_mb') for r in c], 0)}")
    print(f"- B standard (2 GiB): peak RSS MB p50/max {trio([r.get('peak_rss_mb') for r in b], 0)}")
    print("\n### Tor bootstrap\n")
    allr = all_rows
    retried = [r for r in allr if (r.get("tor_bootstrap_attempts") or 0) > 1]
    failed = [r for r in allr if r.get("status") != "ok" and (r.get("tor_bootstrap_attempts") or 0) == 0]
    print(f"- tasks: {len(allr)}; needed a bootstrap retry: {len(retried)}; no result or bootstrap failure after 2 attempts: {len(failed)}")
    print(f"- bootstrap seconds p50/p90/max: {trio([r.get('tor_bootstrap_ms') for r in allr], 1, 1/1000)}")
    print("\n## Cost tables\n")
    print(credits_table(good["B"], "Recommended credits, variant B (launch configuration)") + "\n")
    print(credits_table(good["A"], "Variant A") + "\n")


if __name__ == "__main__":
    main()
