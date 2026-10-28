#!/usr/bin/env python3
"""Content-safety scan of stored data (H211). Read-only: the database session is read-only and the buckets are
only read. Writes a manifest of findings (ids, object names, rule ids, SHA-256 hashes; never any text) and prints a
summary table. safety_purge.py acts on the manifest.

  DATABASE_URL=<owner url> python safety_scan.py --out manifest.json \\
      --runs-bucket voidaccess-cloud-runs --archive-bucket voidaccess-cloud-archive

Buckets are read with Application Default Credentials (or GCS_ACCESS_TOKEN). --runs-dir / --archive-dir read a
local copy instead. Needs voidaccess==2.1.1 and psycopg 3 in the same environment.

Scans: (a) every runs-bucket object (pages.jsonl.gz per line, bundle.json, exports); (b) archive snapshots referenced
by archive_sources.snapshot_path, archive_sources url and excerpt, archive URL entities; (c) inv_sources name, url and
excerpt; (d) inv_entities (URL types and text types) and inv_actors; (e) inv_summary markdown, key_findings and
risk_notes; (f) inv_exports of every investigation (a) to (e) touched.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import safety_common as sc  # noqa: E402


def scan(conn, runs: Optional[sc.ObjectStore], archive: Optional[sc.ObjectStore]) -> dict[str, Any]:
    hits: list[dict[str, Any]] = []
    touched_runs: set[str] = set()
    touched_inv: set[str] = set()

    # (a) runs bucket
    if runs is not None:
        for name in runs.list("runs/"):
            run_id = sc.run_id_of(name)
            data = runs.read(name)
            if run_id is None or data is None:
                continue
            if name.endswith("/" + sc.PAGES_NAME):
                for i, rec in enumerate(sc.read_pages(data)):
                    rule = sc.page_record_rule(rec)
                    if rule:
                        hits.append({
                            "kind": "runs_page", "rule": rule, "run_id": run_id, "object": name, "line": i,
                            "content_hash": rec.get("content_hash"), "sha256": sc.sha256(rec.get("text") or ""),
                        })
                        touched_runs.add(run_id)
            else:
                rule = sc.blob_rule(data)
                if rule:
                    hits.append({"kind": "runs_object", "rule": rule, "run_id": run_id, "object": name,
                                 "sha256": sc.sha256(data)})
                    touched_runs.add(run_id)

    # (b) archive
    for r in sc.rows(conn, "SELECT id::text, url, excerpt, snapshot_path, content_hash FROM archive_sources "
                           "WHERE tombstoned_at IS NULL"):
        for field, rule in (("url", sc.url_rule(r["url"])), ("excerpt", sc.text_rule(r["excerpt"]))):
            if rule:
                hits.append({"kind": "archive_source", "rule": rule, "source_id": r["id"], "field": field,
                             "sha256": sc.sha256(r[field] or "")})
        if archive is not None and r["snapshot_path"]:
            data = archive.read(r["snapshot_path"])
            rule = sc.blob_rule(data) if data else None
            if rule:
                hits.append({"kind": "archive_snapshot", "rule": rule, "object": r["snapshot_path"],
                             "content_hash": r["content_hash"], "source_id": r["id"], "sha256": sc.sha256(data)})
    for r in sc.rows(conn, "SELECT id::text, type, canonical_value, display_value FROM archive_entities "
                           "WHERE tombstoned_at IS NULL"):
        rule = sc.entity_rule(r["type"], r["canonical_value"]) or sc.entity_rule(r["type"], r["display_value"])
        if rule:
            hits.append({"kind": "archive_entity", "rule": rule, "entity_id": r["id"], "type": r["type"],
                         "sha256": sc.sha256(r["display_value"] or "")})

    # (c) inv_sources
    for r in sc.rows(conn, "SELECT id::text, investigation_id::text AS inv, bundle_id, name, url, excerpt "
                           "FROM inv_sources"):
        for field, rule in (("name", sc.text_rule(r["name"]) or sc.url_rule(r["name"])),
                            ("url", sc.url_rule(r["url"])), ("excerpt", sc.text_rule(r["excerpt"]))):
            if rule:
                hits.append({"kind": "inv_source", "rule": rule, "id": r["id"], "investigation_id": r["inv"],
                             "bundle_id": r["bundle_id"], "field": field, "sha256": sc.sha256(r[field] or "")})
                touched_inv.add(r["inv"])

    # (d) inv_entities and inv_actors
    for r in sc.rows(conn, "SELECT id::text, investigation_id::text AS inv, bundle_id, type, value, display_value "
                           "FROM inv_entities"):
        rule = sc.entity_rule(r["type"], r["value"]) or sc.entity_rule(r["type"], r["display_value"])
        if rule:
            hits.append({"kind": "inv_entity", "rule": rule, "id": r["id"], "investigation_id": r["inv"],
                         "bundle_id": r["bundle_id"], "type": r["type"],
                         "sha256": sc.sha256(r["value"] or r["display_value"] or "")})
            touched_inv.add(r["inv"])
    for r in sc.rows(conn, "SELECT id::text, investigation_id::text AS inv, handle, aliases, summary FROM inv_actors"):
        text = "\n".join([r["handle"] or "", *(r["aliases"] or []), r["summary"] or ""])
        rule = sc.text_rule(text)
        if rule:
            hits.append({"kind": "inv_actor", "rule": rule, "id": r["id"], "investigation_id": r["inv"],
                         "sha256": sc.sha256(text)})
            touched_inv.add(r["inv"])

    # (e) inv_summary
    for r in sc.rows(conn, "SELECT id::text, investigation_id::text AS inv, markdown, key_findings, risk_notes "
                           "FROM inv_summary"):
        if r["markdown"] == sc.SUMMARY_NOTICE:
            continue
        for field in ("markdown", "key_findings", "risk_notes"):
            value = r[field]
            text = value if isinstance(value, str) else "\n".join(str(x) for x in (value or []))
            rule = sc.text_rule(text)
            if rule:
                hits.append({"kind": "inv_summary", "rule": rule, "id": r["id"], "investigation_id": r["inv"],
                             "field": field, "sha256": sc.sha256(text)})
                touched_inv.add(r["inv"])

    # run ids are investigation ids
    existing = {r["id"] for r in sc.rows(conn, "SELECT id::text FROM investigations WHERE id::text = ANY(%s)",
                                         (sorted(touched_runs),))} if touched_runs else set()
    touched_inv |= existing

    # (f) exports of every touched investigation (all of them are deleted by the purge; content hits are flagged)
    exports: list[dict[str, Any]] = []
    if touched_inv:
        for r in sc.rows(conn, "SELECT id::text, investigation_id::text AS inv, format, object_path, content "
                               "FROM inv_exports WHERE investigation_id::text = ANY(%s)", (sorted(touched_inv),)):
            data = bytes(r["content"]) if r["content"] is not None else None
            if data is None and runs is not None and str(r["object_path"]).startswith("runs/"):
                data = runs.read(r["object_path"])
            rule = sc.blob_rule(data) if data else None
            exports.append({"id": r["id"], "investigation_id": r["inv"], "format": r["format"],
                            "object_path": r["object_path"], "rule": rule})
            if rule:
                hits.append({"kind": "inv_export", "rule": rule, "id": r["id"], "investigation_id": r["inv"],
                             "format": r["format"], "sha256": sc.sha256(data)})

    counts = Counter(h["kind"] for h in hits)
    return {
        "manifest_version": sc.MANIFEST_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "hits": hits,
        "affected": {"investigations": sorted(touched_inv), "runs": sorted(touched_runs)},
        "exports": exports,
        "counts": dict(counts),
    }


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="manifest path (JSON)")
    ap.add_argument("--runs-bucket", default=os.environ.get("RUNS_BUCKET"))
    ap.add_argument("--runs-dir", help="a local copy of the runs bucket instead")
    ap.add_argument("--archive-bucket", default=os.environ.get("ARCHIVE_BUCKET"))
    ap.add_argument("--archive-dir", help="a local copy of the archive bucket instead")
    args = ap.parse_args(argv)

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL is not set")
    detector = sc.require_detector()
    conn = sc.connect(dsn, read_only=True)
    runs = sc.open_store(args.runs_bucket, args.runs_dir, read_only=True)
    archive = sc.open_store(args.archive_bucket, args.archive_dir, read_only=True)
    if runs is None or archive is None:
        print("note: no runs and/or archive store given; those objects are not scanned", file=sys.stderr)
    manifest = scan(conn, runs, archive)
    manifest["detector"] = detector
    Path(args.out).write_text(json.dumps(manifest, indent=1, sort_keys=True), encoding="utf-8")
    sc.print_table("content-safety findings (counts only):", manifest["counts"])
    print(f"investigations affected: {len(manifest['affected']['investigations'])}  "
          f"runs affected: {len(manifest['affected']['runs'])}  "
          f"export rows to delete: {len(manifest['exports'])}")
    print(f"manifest: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
