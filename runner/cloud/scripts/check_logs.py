#!/usr/bin/env python3
"""Log-leak check (guarantee 1) on real Cloud Logging output.

Usage: check_logs.py <logs.json from `gcloud logging read --format=json`> <plan.json> <root.txt>
Looks for every run's query text, the derived callback secrets and any extra secret values named in the
LEAK_EXTRA_SECRETS env var (comma-separated file paths whose contents are secrets) in every log entry. Prints counts
only (never the matched text). Exit 1 on any match.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
from pathlib import Path


def derive(root: str, label: str, run_id: str) -> str:
    return hmac.new(root.encode(), f"{label}:{run_id}".encode(), hashlib.sha256).hexdigest()


def main() -> int:
    logs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    plan = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    root = Path(sys.argv[3]).read_text(encoding="utf-8").strip()
    needles: dict[str, str] = {}
    for p in plan:
        needles[f"query[{p['label']}]"] = p["query"]
        needles[f"callback_secret[{p['label']}]"] = derive(root, "callback", p["id"])
    for path in filter(None, os.environ.get("LEAK_EXTRA_SECRETS", "").split(",")):
        needles[f"extra[{Path(path).name}]"] = Path(path).read_text(encoding="utf-8").strip()
    blob = "\n".join(json.dumps(e, ensure_ascii=False) for e in logs).lower()
    leaks = {k: blob.count(v.lower()) for k, v in needles.items() if v}
    total = sum(leaks.values())
    print(f"log entries scanned: {len(logs)}; needles: {len(needles)}; total matches: {total}")
    for k, n in sorted(leaks.items()):
        if n:
            print(f"LEAK {k}: {n}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
