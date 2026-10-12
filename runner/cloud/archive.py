"""pages.jsonl.gz: input for the future archive lane (P4). One line per fetched page, nothing else:

    {"url": ..., "fetched_at": ..., "content_hash": ..., "text": <sanitized text>}

`text` is the output of the engine's `sanitizer.gate.sanitize_page` (content-safety drop, credentials to
presence-only, PII and personal names removed). A page the gate drops is omitted. `content_hash` is the
SHA-256 of the page's cleaned text before sanitization (stable across runs, for de-duplication).
"""

from __future__ import annotations

import gzip
import io
import json
from typing import Any


def build_pages_archive(sanitized: dict[str, str], page_info: dict[str, dict[str, Any]]) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        for pid in sorted(sanitized, key=lambda p: page_info[p]["url"]):
            info = page_info[pid]
            line = {
                "url": info["url"],
                "fetched_at": info["fetched_at"],
                "content_hash": info["content_hash"],
                "text": sanitized[pid],
            }
            gz.write((json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    return buf.getvalue()
