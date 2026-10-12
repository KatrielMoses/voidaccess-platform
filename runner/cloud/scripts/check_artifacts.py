#!/usr/bin/env python3
"""Validate the artifacts of finished runs (Stage-1 proof): schema, integrity, completeness, no raw credentials.

Usage: check_artifacts.py <dir containing <run_id>/{bundle.json,stix.json,...}> [run_id ...]
Prints one line per run and exits non-zero if any completed run fails a check. Never prints artifact content.
"""

from __future__ import annotations

import gzip
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cloud.bundle import integrity_problems  # noqa: E402
from cloud.spec import schema_errors  # noqa: E402

EXPORT_FILES = ["stix.json", "misp.json", "sigma.yml", "yara.yar", "snort.rules", "suricata.rules"]
PAGES = "pages.jsonl.gz"
# Raw credential / PII shapes that must not appear anywhere in an artifact.
RAW_PATTERNS = {
    "aws_access_key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "github_token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    "openai_style_key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "slack_token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    "google_api_key": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    "stripe_key": re.compile(r"\b[sr]k_live_[A-Za-z0-9]{16,}\b"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    "email_colon_password": re.compile(r"\b[\w.+-]{2,}@[\w-]+\.[\w.-]+:[^\s\"',;]{4,}"),
    "unmasked_email": re.compile(r"\b[A-Za-z0-9._%+-]{2,}@(?!example\.)[A-Za-z0-9-]+\.[A-Za-z]{2,}\b"),
    "private_key_block": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]{40,}"),
}
# Detection-pattern strings the YARA exporter writes on purpose (header lines, not key material).
ALLOWED_CONTEXT = ("-----BEGIN",)


def scan_text(name: str, text: str) -> list[str]:
    hits = []
    for label, pat in RAW_PATTERNS.items():
        for m in pat.finditer(text):
            if label == "private_key_block" and not re.search(r"[A-Za-z0-9+/=]{40,}", m.group(0)):
                continue
            hits.append(f"{name}: {label}")
            break
    return hits


def check_run(run_dir: Path) -> tuple[list[str], dict]:
    problems: list[str] = []
    info: dict = {}
    bundle_path = run_dir / "bundle.json"
    if not bundle_path.exists():
        return ["bundle.json missing"], info
    raw_bundle = bundle_path.read_text(encoding="utf-8")
    bundle = json.loads(raw_bundle)
    errs = schema_errors("ResultBundle", bundle, limit=3)
    problems += [f"bundle schema: {e}" for e in errs]
    if not errs:
        problems += [f"bundle integrity: {p}" for p in integrity_problems(bundle)[:3]]
    info.update(
        entities=len(bundle.get("entities", [])),
        relationships=len(bundle.get("relationships", [])),
        sources=len(bundle.get("sources", [])),
        sensitive=sum(1 for e in bundle.get("entities", []) if e.get("sensitive")),
        summary_kind=bundle.get("summary", {}).get("summary_kind"),
        export_errors=bundle.get("metrics", {}).get("export_errors"),
        dropped=bundle.get("metrics", {}).get("dropped_entities"),
    )
    for e in bundle.get("sources", []):
        if len(e.get("excerpt", "")) > 500:
            problems.append("excerpt over 500 chars")
    texts = {"bundle.json": raw_bundle}
    for name in EXPORT_FILES:
        p = run_dir / name
        if not p.exists():
            if name.split(".")[0] not in (info.get("export_errors") or {}):
                problems.append(f"{name} missing")
            continue
        texts[name] = p.read_text(encoding="utf-8", errors="replace")
    pages = run_dir / PAGES
    if not pages.exists():
        problems.append(f"{PAGES} missing")
    else:
        lines = gzip.decompress(pages.read_bytes()).decode("utf-8").splitlines()
        info["pages_lines"] = len(lines)
        for ln in lines:
            row = json.loads(ln)
            if set(row) != {"url", "fetched_at", "content_hash", "text"}:
                problems.append("pages.jsonl.gz line has unexpected keys")
                break
        texts[PAGES] = "\n".join(json.loads(ln)["text"] for ln in lines)
    for name, text in texts.items():
        problems += scan_text(name, text)
    return problems, info


def main() -> int:
    root = Path(sys.argv[1])
    wanted = sys.argv[2:] or sorted(p.name for p in root.iterdir() if p.is_dir() and any(p.iterdir()))  # runs with artifacts
    failed = 0
    for rid in wanted:
        problems, info = check_run(root / rid)
        status = "OK " if not problems else "BAD"
        failed += bool(problems)
        print(f"{status} {rid[:8]} {json.dumps(info, sort_keys=True)} {'; '.join(problems)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
