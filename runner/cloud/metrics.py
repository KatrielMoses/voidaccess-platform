"""Small pure helpers for the run metrics and the cost limits."""

from __future__ import annotations

from typing import Any


def enrichment_calls(sources_used: Any, allowlist: str | None) -> dict[str, int]:
    """Enrichment sources that ran, as {source id: 1}. `sources_used` is the engine's per-source status table; it also
    lists sources the licensed allowlist turned off (they report `ok` with 0 results but make no network call) and the
    search-stage sources, so only ids on the allowlist count. 1 means "ran at least once": the engine does not report
    how many requests a source made."""
    allowed = {x.strip() for x in (allowlist or "").split(",") if x.strip()}
    out: dict[str, int] = {}
    for name, info in (sources_used or {}).items():
        if not isinstance(info, dict) or not str(info.get("status", "")).startswith(("ok", "ran")):
            continue
        if not allowed or name in allowed:
            out[str(name)] = 1
    return out


def lower_only(default: float, override: str | None) -> float:
    """An operator override (a test run with a tiny budget or cap) may only TIGHTEN a cost limit, never loosen it."""
    try:
        value = float(override) if override else None
    except ValueError:
        value = None
    return min(default, value) if value is not None and value > 0 else default
