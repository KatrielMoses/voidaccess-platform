"""Contract v2 `trace` events: the runner's mirror of packages/engine-client/src/trace.ts.

`sanitize_trace` turns whatever the engine emitted into a contract trace event, or None when it must not be sent.
It never raises. Rules, on top of the app's own validator:
  * unknown stages and unknown kinds are dropped (the app would ignore an unknown kind anyway);
  * a content-safety drop keeps only `url_id` and `reason` / `outcome`, never a host or any other detail;
  * `query.refined.text` is cut to 200 characters and `entity.found.display` to 80;
  * a `url.found` host that looks like a URL or a path (or is not a defanged display host) drops the event;
  * a required field that is missing or malformed drops the event; a malformed optional field is left out;
  * string values go through the sender's redactor (callback secret, API key) before any check.
Keep the kinds and limits in step with trace.ts; it is the canonical validator.
"""

from __future__ import annotations

import math
import re
from typing import Any, Callable

TRACE_SCHEMA = 2
STAGES = ("refine", "collect", "filter", "fetch", "extract", "enrich", "graph", "summarize")
TRACE_KINDS = (
    "query.refined",
    "search.request",
    "search.result",
    "url.found",
    "url.kept",
    "url.dropped",
    "page.fetched",
    "page.entities",
    "entity.found",
    "enrich.source",
    "graph.progress",
    "summary.status",
    "trace.truncated",
    # contract v0.4 (engine 2.2): the LLM relevance filter returned nothing usable, every candidate was kept
    "filter_fallback",
)
TEXT_MAX = 200
DISPLAY_MAX = 80
HOST_MIN, HOST_MAX = 4, 80
BY_TYPE_MAX_KEYS = 40
COUNT_MAX = 1_000_000
MS_MAX = 3_600_000
BYTES_MAX = 1_000_000_000

SEARCH_STATUS = ("ok", "error", "timeout", "disabled", "no_key")
DROP_REASONS = ("duplicate", "irrelevant", "cap", "invalid", "ssrf", "safety", "disabled_source")
FETCH_OUTCOMES = (
    "ok", "http_404", "http_4xx", "http_5xx", "timeout", "tor_error", "too_large", "safety_dropped", "empty", "error",
)
ENRICH_STATUS = ("ok", "error", "timeout", "disabled", "no_key", "skipped")
SUMMARY_KINDS = ("llm", "fallback", "none")
FILTER_SCOPES = ("onion", "clearnet")

_URL_ID = re.compile(r"^u[0-9]{1,6}$")
_ENTITY_ID = re.compile(r"^e[0-9]{1,6}$")
_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")
# search engines and enrichment sources keep the engine's own name ("Ahmia (Clearnet Proxy)")
_SOURCE_NAME = re.compile(r"^[A-Za-z0-9_.() -]{1,40}$")
# "*" is the engine's mask for a name that contains an abuse term ("********…fcid[.]onion")
_HOST = re.compile(r"^[a-z0-9.\-…*\[\]]+$", re.IGNORECASE)
_MARKUP = re.compile(r"[<>\x00-\x1f]")
_SCHEME = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_CLEAR_EMAIL = re.compile(r"(^|[^*\w.])[\w.+-]*[A-Za-z0-9]{2}[\w.+-]*@[\w-]+\.[\w.-]+", re.ASCII)

_MISSING = object()


class _Bad(Exception):
    """A field failed its check."""


# -- field checks (each returns the clean value or raises _Bad) ---------------------------------------------------


def _int(v: Any, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise _Bad
    if isinstance(v, float):
        if not math.isfinite(v):
            raise _Bad
        v = round(v)
    if not lo <= v <= hi:
        raise _Bad
    return int(v)


def _count(hi: int = COUNT_MAX) -> Callable[[Any], int]:
    return lambda v: _int(v, 0, hi)


def _unit(v: Any) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1:
        raise _Bad
    return float(v)


def _regex(pattern: re.Pattern[str]) -> Callable[[Any], str]:
    def check(v: Any) -> str:
        if not isinstance(v, str) or not pattern.match(v):
            raise _Bad
        return v

    return check


def _enum(values: tuple[str, ...]) -> Callable[[Any], str]:
    def check(v: Any) -> str:
        if v not in values:
            raise _Bad
        return v

    return check


def _text(v: Any) -> str:
    if not isinstance(v, str):
        raise _Bad
    v = v[:TEXT_MAX]
    if not v:
        raise _Bad
    return v


def _display(v: Any) -> str:
    if not isinstance(v, str):
        raise _Bad
    v = v[:DISPLAY_MAX]
    if not v or _MARKUP.search(v) or _SCHEME.search(v) or _CLEAR_EMAIL.search(v):
        raise _Bad
    return v


def host_is_display_form(v: Any) -> bool:
    """A defanged display host ("example[.]com", "abcdefgh…wxyz[.]onion"), never a URL, a path or a query."""
    if not isinstance(v, str) or not HOST_MIN <= len(v) <= HOST_MAX:
        return False
    if "/" in v or "://" in v or "?" in v or any(c.isspace() for c in v):
        return False
    return bool(_HOST.match(v)) and "[.]" in v


def _host(v: Any) -> str:
    if not host_is_display_form(v):
        raise _Bad
    return v


def _by_type(v: Any) -> dict[str, int]:
    if not isinstance(v, dict):
        raise _Bad
    out: dict[str, int] = {}
    for k, n in v.items():
        if len(out) >= BY_TYPE_MAX_KEYS:
            break
        try:
            out[_regex(_NAME)(k)] = _count()(n)
        except _Bad:
            continue
    return out


_name = _regex(_NAME)
_source_name = _regex(_SOURCE_NAME)
_url_id = _regex(_URL_ID)
_entity_id = _regex(_ENTITY_ID)

# kind -> {field: (required, check)}; fields not listed are dropped.
_FIELDS: dict[str, dict[str, tuple[bool, Callable[[Any], Any]]]] = {
    "query.refined": {"index": (True, _count(50)), "text": (True, _text)},
    "search.request": {"engine": (True, _source_name), "query_index": (True, _count(50))},
    "search.result": {
        "engine": (True, _source_name),
        "query_index": (True, _count(50)),
        "status": (True, _enum(SEARCH_STATUS)),
        "results": (True, _count()),
        "ms": (False, _count(MS_MAX)),
    },
    "url.found": {
        "url_id": (True, _url_id),
        "host": (True, _host),
        "engine": (False, _source_name),
        "depth": (False, _count(10)),
    },
    "url.kept": {"url_id": (True, _url_id), "score": (False, _unit)},
    "url.dropped": {"url_id": (True, _url_id), "reason": (True, _enum(DROP_REASONS))},
    "page.fetched": {
        "url_id": (True, _url_id),
        "outcome": (True, _enum(FETCH_OUTCOMES)),
        "http_status": (False, lambda v: _int(v, 100, 599)),
        "bytes": (False, _count(BYTES_MAX)),
        "ms": (False, _count(MS_MAX)),
    },
    "page.entities": {"url_id": (True, _url_id), "by_type": (True, _by_type)},
    "entity.found": {
        "entity_id": (True, _entity_id),
        "type": (True, _name),
        "display": (True, _display),
        "confidence": (False, _unit),
        "url_id": (False, _url_id),
    },
    "enrich.source": {
        "source": (True, _source_name),
        "status": (True, _enum(ENRICH_STATUS)),
        "hits": (False, _count()),
    },
    "graph.progress": {"nodes": (True, _count()), "edges": (True, _count()), "communities": (False, _count())},
    "summary.status": {"kind": (True, _enum(SUMMARY_KINDS)), "attempt": (False, _count(20))},
    "trace.truncated": {"kind": (True, _enum(TRACE_KINDS)), "dropped": (True, _count())},
    "filter_fallback": {
        "scope": (True, _enum(FILTER_SCOPES)),
        "candidates": (True, _count()),
        "kept": (True, _count()),
    },
}
assert set(_FIELDS) == set(TRACE_KINDS)


def is_safety_drop(kind: str, data: dict[str, Any]) -> bool:
    return (kind == "url.dropped" and data.get("reason") == "safety") or (
        kind == "page.fetched" and data.get("outcome") == "safety_dropped"
    )


def sanitize_data(kind: str, data: Any, redact: Callable[[str], str] | None = None) -> dict[str, Any] | None:
    """The contract `data` for `kind`, or None when the event must be dropped. Never raises."""
    try:
        spec = _FIELDS.get(kind)
        if spec is None or not isinstance(data, dict):
            return None
        # Safety rule first: a safety drop is reduced to its id and reason before anything else is looked at.
        if is_safety_drop(kind, data):
            key = "reason" if kind == "url.dropped" else "outcome"
            return {"url_id": _url_id(data.get("url_id")), key: data[key]}
        out: dict[str, Any] = {}
        for name, (required, check) in spec.items():
            value = data.get(name, _MISSING)
            if value is None:
                value = _MISSING
            if value is _MISSING:
                if required:
                    return None
                continue
            if redact is not None and isinstance(value, str):
                value = redact(value)
            try:
                out[name] = check(value)
            except _Bad:
                if required:
                    return None
        return out
    except Exception:
        return None


def stage_value(stage: Any) -> str | None:
    value = getattr(stage, "value", stage)
    return value if isinstance(value, str) and value in STAGES else None


def sanitize_trace(event: dict[str, Any], redact: Callable[[str], str] | None = None) -> dict[str, Any] | None:
    """The contract fields of a trace event (type, schema, stage, kind, data and `at` if present), or None."""
    try:
        if event.get("type") != "trace":
            return None
        stage = stage_value(event.get("stage"))
        kind = event.get("kind")
        if stage is None or kind not in _FIELDS:
            return None
        data = sanitize_data(kind, event.get("data"), redact)
        if data is None:
            return None
        out: dict[str, Any] = {"type": "trace", "schema": TRACE_SCHEMA, "stage": stage, "kind": kind, "data": data}
        if isinstance(event.get("at"), str) and event["at"]:
            out["at"] = event["at"]
        return out
    except Exception:
        return None
