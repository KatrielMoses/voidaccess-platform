"""G5 (R2b-5): a run whose dark-web sources were unreachable ends `failed: sources_unreachable` (full refund) instead of
"completing" with near-empty results.

Built only from the engine's contract-v2 trace events (the runner always turns them on):
  * `search.request` / `search.result` for the onion search engines (names from the engine's own catalog; side
    sources such as GitHub or RSS report through the same kinds and are ignored here). An engine answers when any
    of its results reads `ok` (zero links is still an answer); an engine that was asked and never answered `ok`
    (timeout, error, cut by the search deadline) failed. `disabled` alone (circuit breaker, deny-list) is neither.
  * `url.found` with an onion display host, then `page.fetched` outcome `ok` for that url id: the engine reports
    `ok` only for a page it stored with text (2.1.0 stores nothing for a failed or empty fetch).

The decision is taken at the two stage boundaries where it is final and before the expensive stages:
  * end of `collect`: engines failed >= the ratio AND not a single onion URL was found (nothing could be fetched);
  * end of `fetch`:   engines failed >= the ratio AND no onion page with content was fetched.
A Tor client that never bootstrapped is decided by run.py directly. An engine that emits no trace events never
trips the rule (fail open: such a run is judged as before).
"""

from __future__ import annotations

import threading
from typing import Any, Iterable

from . import constants as C


def onion_engine_names() -> frozenset[str]:
    try:
        from search.engine_catalog import SEARCH_ENGINES
    except Exception:
        return frozenset()
    return frozenset(str(e.get("name")) for e in SEARCH_ENGINES if e.get("name"))


class Reachability:
    """Fed every engine event (any thread); `check(stage)` says whether the run must stop as unreachable."""

    def __init__(self, onion_engines: Iterable[str] | None = None):
        self.onion_engines = frozenset(onion_engines) if onion_engines is not None else onion_engine_names()
        self._lock = threading.Lock()
        self.asked: set[str] = set()
        self.answered: set[str] = set()
        self.onion_url_ids: set[str] = set()
        self.onion_pages_ok = 0

    def observe(self, event: dict[str, Any]) -> None:
        if event.get("type") != "trace":
            return
        kind, data = event.get("kind"), event.get("data") or {}
        if not isinstance(data, dict):
            return
        with self._lock:
            if kind in ("search.request", "search.result"):
                name = str(data.get("engine") or "")
                if name not in self.onion_engines:
                    return
                status = data.get("status")
                if kind == "search.request" or status in ("ok", "timeout", "error"):
                    self.asked.add(name)
                if status == "ok":
                    self.answered.add(name)
            elif kind == "url.found":
                if str(data.get("host") or "").endswith("[.]onion") and data.get("url_id"):
                    self.onion_url_ids.add(str(data["url_id"]))
            elif kind == "page.fetched":
                if data.get("outcome") == "ok" and str(data.get("url_id") or "") in self.onion_url_ids:
                    self.onion_pages_ok += 1

    def summary(self) -> dict[str, int]:
        with self._lock:
            return {
                "onion_engines_asked": len(self.asked),
                "onion_engines_answered": len(self.answered & self.asked),
                "onion_urls_found": len(self.onion_url_ids),
                "onion_pages_with_content": self.onion_pages_ok,
            }

    def engines_failed(self) -> bool:
        s = self.summary()
        asked = s["onion_engines_asked"]
        return asked > 0 and (asked - s["onion_engines_answered"]) / asked >= C.UNREACHABLE_ENGINE_FAIL_RATIO

    def check(self, stage_ended: str) -> bool:
        """True when the run must end as `sources_unreachable` now that `stage_ended` is over."""
        if stage_ended not in ("collect", "fetch") or not self.engines_failed():
            return False
        s = self.summary()
        if stage_ended == "collect":
            return s["onion_urls_found"] == 0
        return s["onion_pages_with_content"] == 0
