"""Detect model refusals and empty outputs when pages existed."""

from __future__ import annotations

import re
from typing import Any

_REFUSAL_PATTERNS = [
    re.compile(p, re.I)
    for p in (
        r"\bi cannot (?:help|assist|provide)",
        r"\bi can't (?:help|assist|provide)",
        r"\bi am unable to",
        r"\bas an ai language model",
        r"\bi must (?:decline|refuse)",
        r"\bagainst my (?:guidelines|policy)",
        r"\bethical (?:concerns|guidelines)",
        r"\billegal (?:to|activity)",
        r"\bnot able to (?:comply|assist)",
    )
]


def _looks_like_refusal(text: str) -> bool:
    if not text or len(text.strip()) < 20:
        return False
    return any(p.search(text) for p in _REFUSAL_PATTERNS)


def detect_refusals(
    cli_payload: dict[str, Any],
    *,
    pages_count: int,
) -> dict[str, Any]:
    flags: list[str] = []
    summary = (cli_payload.get("summary") or "").strip()
    entities = cli_payload.get("entities") or []
    pages_scraped = cli_payload.get("pages_scraped") or []
    n_pages = pages_count or len(pages_scraped)

    if _looks_like_refusal(summary):
        flags.append("summary_refusal_language")

    if n_pages > 0 and not entities:
        flags.append("empty_entities_with_pages")

    if n_pages > 0 and (not summary or len(summary) < 40):
        flags.append("empty_or_tiny_summary_with_pages")

    status = cli_payload.get("status") or ""
    if status == "completed_no_results" and n_pages > 0:
        flags.append("completed_no_results_despite_pages")

    return {
        "refusal_detected": bool(flags),
        "refusal_flags": flags,
    }
