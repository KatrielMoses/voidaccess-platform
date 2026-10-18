"""Small pure helpers for the run metrics and the cost limits."""

from __future__ import annotations

from typing import Any


def enrichment_calls(sources_used: Any, allowlist: str | None) -> dict[str, int]:
    """HTTP requests per enrichment source, as {source id: requests}. Since E1C the engine reports each source's real
    status and its request count; every allowlisted source that made requests counts, whatever its status (2.1.0:
    `ok`, `error`, `partial`, `timed_out`), because a cut-off call was still made. Older engines (no `requests`
    field) report 1 for a source that ran."""
    allowed = {x.strip() for x in (allowlist or "").split(",") if x.strip()}
    out: dict[str, int] = {}
    for name, info in (sources_used or {}).items():
        if not isinstance(info, dict) or (allowed and name not in allowed):
            continue
        if "requests" in info:
            n = int(info.get("requests") or 0)
            if n > 0:
                out[str(name)] = n
        elif str(info.get("status", "")).startswith(("ok", "ran")):
            out[str(name)] = 1
    return out


def lower_only(default: float, override: str | None) -> float:
    """An operator override (a test run with a tiny budget or cap) may only TIGHTEN a cost limit, never loosen it."""
    try:
        value = float(override) if override else None
    except ValueError:
        value = None
    return min(default, value) if value is not None and value > 0 else default
