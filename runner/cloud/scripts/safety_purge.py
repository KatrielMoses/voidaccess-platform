#!/usr/bin/env python3
"""Remove what safety_scan.py found (H211). DRY-RUN BY DEFAULT: without --apply nothing is written (the database
session is read-only and the buckets are opened read-only); the plan is printed as counts.

  DATABASE_URL=<owner url> python safety_purge.py manifest.json \\
      --runs-bucket voidaccess-cloud-runs --archive-bucket voidaccess-cloud-archive [--apply]

With --apply, in this order:
  1. archive: page hashes, sources and URL entities go through @voidaccess/archive's removeFromArchive
     (packages/archive/scripts/remove-pages.ts), which tombstones, deletes every object version, records removed pages
     and writes audit_log. It needs ARCHIVE_DATABASE_URL (va_app) and ARCHIVE_DATABASE_URL_SYSTEM (va_worker), plus
     RLS_CONTEXT_KEY when NODE_ENV=production. Flagged excerpts of the removed sources are then blanked.
  2. runs bucket: each pages.jsonl.gz is rewritten without its flagged lines (deleted when none is left) and every
     older version is deleted; other flagged objects (bundle.json, exports) are deleted with all their versions.
  3. per investigation, one transaction: flagged inv_sources; flagged inv_entities and entities supported only by
     deleted sources; relationships and actors left without entities (or flagged); the summary replaced by a fixed
     notice when flagged (the row is replaced: inv_* rows refuse UPDATE); every inv_exports row; one audit_log row ("content_safety_purge", counts only). The
     investigation's export objects in the runs bucket are deleted after the commit.
Running it twice changes nothing the second time. Never prints or logs flagged text.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import safety_common as sc  # noqa: E402

PLATFORM_ROOT = Path(__file__).resolve().parents[3]
EXPORT_FILES = ("stix.json", "misp.json", "sigma.yml", "yara.yar", "snort.rules", "suricata.rules")
ACTION = "content_safety_purge"


def _by_kind(manifest: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for h in manifest.get("hits", []):
        out[h["kind"]].append(h)
    return out


# ---- 1. archive --------------------------------------------------------------------------------------------


def archive_plan(conn, hits: dict[str, list[dict[str, Any]]]) -> dict[str, list[str]]:
    """What is still to remove: page hashes not yet removed, sources and entities not yet tombstoned."""
    pages = sorted({h["content_hash"] for h in hits["archive_snapshot"] if h.get("content_hash")})
    sources = sorted({h["source_id"] for h in hits["archive_source"]})
    entities = sorted({h["entity_id"] for h in hits["archive_entity"]})
    if pages:
        done = {r["h"] for r in sc.rows(conn, "SELECT content_hash AS h FROM archive_removed_pages "
                                              "WHERE content_hash = ANY(%s)", (pages,))}
        pages = [p for p in pages if p not in done]
    if sources:
        live = {r["id"] for r in sc.rows(conn, "SELECT id::text FROM archive_sources WHERE id::text = ANY(%s) "
                                               "AND tombstoned_at IS NULL", (sources,))}
        sources = [s for s in sources if s in live]
    if entities:
        live = {r["id"] for r in sc.rows(conn, "SELECT id::text FROM archive_entities WHERE id::text = ANY(%s) "
                                               "AND tombstoned_at IS NULL", (entities,))}
        entities = [e for e in entities if e in live]
    return {"pages": pages, "sources": sources, "entities": entities}


def blank_excerpts(conn, source_ids: list[str], actor: str) -> int:
    if not source_ids:
        return 0
    with conn.transaction():
        n = conn.execute("UPDATE archive_sources SET excerpt = '' WHERE id::text = ANY(%s) AND excerpt <> ''",
                         (source_ids,)).rowcount
        if n:
            conn.execute("INSERT INTO audit_log (actor, action, target, meta) VALUES (%s, %s, %s, %s::jsonb)",
                         (actor, ACTION, "archive", json.dumps({"archive_excerpts_blanked": n})))
    return n


def run_archive_removal(plan: dict[str, list[str]], reason: str, actor: str, archive_dir: Optional[str],
                        archive_bucket: Optional[str], command: Optional[list[str]] = None) -> dict[str, Any]:
    if not any(plan.values()):
        return {}
    env = dict(os.environ)
    for k in ("ARCHIVE_DATABASE_URL", "ARCHIVE_DATABASE_URL_SYSTEM"):
        if not env.get(k):
            raise SystemExit(f"{k} is not set (the archive removal path runs as va_app / va_worker)")
    env["DATABASE_URL"] = env["ARCHIVE_DATABASE_URL"]
    env["DATABASE_URL_SYSTEM"] = env["ARCHIVE_DATABASE_URL_SYSTEM"]
    if archive_dir:
        env["ARCHIVE_STORE_DIR"] = archive_dir
    elif archive_bucket:
        env["ARCHIVE_BUCKET"] = archive_bucket
        env.setdefault("GCS_ACCESS_TOKEN", sc.adc_access_token())
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(plan, fh)
        path = fh.name
    try:
        cmd = (command or ["pnpm", "--silent", "--filter", "@voidaccess/archive", "exec", "tsx",
                           "scripts/remove-pages.ts"]) + ["--input", path, "--reason", reason, "--actor", actor]
        out = subprocess.run(cmd, cwd=PLATFORM_ROOT, env=env, check=True, capture_output=True, text=True)
    finally:
        os.unlink(path)
    lines = [ln for ln in out.stdout.splitlines() if ln.startswith("{")]
    return json.loads(lines[-1]) if lines else {}


# ---- 2. runs bucket ----------------------------------------------------------------------------------------


def purge_runs(runs: sc.ObjectStore, hits: dict[str, list[dict[str, Any]]], apply: bool) -> Counter:
    c: Counter = Counter()
    for name in sorted({h["object"] for h in hits["runs_page"]}):
        data = runs.read(name)
        if data is None:
            continue
        records = sc.read_pages(data)
        keep = [r for r in records if not sc.page_record_rule(r)]
        if len(keep) == len(records):
            continue
        c["runs_page_lines"] += len(records) - len(keep)
        c["runs_pages_objects"] += 1
        if apply:
            if keep:
                runs.replace(name, sc.write_pages(keep), "application/gzip")
            else:
                runs.delete_all(name)
    for name in sorted({h["object"] for h in hits["runs_object"]}):
        if runs.read(name) is None:
            continue
        c["runs_objects_deleted"] += 1
        if apply:
            runs.delete_all(name)
    return c


# ---- 3. investigations ---------------------------------------------------------------------------------------


# The rows step 3 removes, as conditions on the current rows (so a dry run can count them with SELECTs, and a
# second run finds nothing). Parameters: inv, sources, ents, srcs (deleted sources' bundle ids), actors.
_INV = "investigation_id::text = %(inv)s"
_ENT = f"{_INV} AND (id::text = ANY(%(ents)s) OR (cardinality(source_ids) > 0 AND source_ids <@ %(srcs)s::text[]))"
_LIVE = f"SELECT bundle_id FROM inv_entities WHERE {_INV} AND NOT (id::text = ANY(%(ents)s) OR " \
        f"(cardinality(source_ids) > 0 AND source_ids <@ %(srcs)s::text[]))"
STEPS: tuple[tuple[str, str, str], ...] = (
    ("inv_sources", "inv_sources", f"{_INV} AND id::text = ANY(%(sources)s)"),
    ("inv_relationships", "inv_relationships",
     f"{_INV} AND (source_bundle_id NOT IN ({_LIVE}) OR target_bundle_id NOT IN ({_LIVE}))"),
    ("inv_actors", "inv_actors",
     f"{_INV} AND (id::text = ANY(%(actors)s) OR "
     f"(cardinality(entity_bundle_ids) > 0 AND NOT entity_bundle_ids && ARRAY({_LIVE})))"),
    ("inv_entities", "inv_entities", _ENT),
    ("inv_exports", "inv_exports", _INV),
)
_SUMMARY = f"{_INV} AND markdown <> %(notice)s"


def purge_investigation(conn, inv: str, hits: dict[str, list[dict[str, Any]]], apply: bool, actor: str) -> Counter:
    c: Counter = Counter()
    mine = {k: [h for h in v if h.get("investigation_id") == inv] for k, v in hits.items()}
    params = {
        "inv": inv,
        "sources": sorted({h["id"] for h in mine.get("inv_source", [])}),
        "ents": sorted({h["id"] for h in mine.get("inv_entity", [])}),
        "srcs": sorted({h["bundle_id"] for h in mine.get("inv_source", [])}),
        "actors": sorted({h["id"] for h in mine.get("inv_actor", [])}),
        "notice": sc.SUMMARY_NOTICE,
    }
    summary_hit = bool(mine.get("inv_summary"))
    if not apply:
        for key, table, where in STEPS:
            c[key] = conn.execute(f"SELECT count(*) FROM {table} WHERE {where}", params).fetchone()[0]
        if summary_hit:
            c["inv_summary"] = conn.execute(f"SELECT count(*) FROM inv_summary WHERE {_SUMMARY}", params).fetchone()[0]
        return c
    with conn.transaction():
        # relationships and actors are judged against the entities that remain, so they go before the entities
        for key, table, where in STEPS:
            c[key] = conn.execute(f"DELETE FROM {table} WHERE {where}", params).rowcount
        if summary_hit:
            # inv_summary rows are immutable (UPDATE is refused by a trigger): replace the row, same id, in this
            # transaction.
            cols = [r[0] for r in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() "
                "AND table_name = 'inv_summary' ORDER BY ordinal_position"
            ).fetchall()]
            replaced = {"markdown": "%(notice)s", "key_findings": "'[]'::jsonb", "risk_notes": "'[]'::jsonb"}
            names = ", ".join(f'"{col}"' for col in cols)
            select = ", ".join(replaced.get(col, f'old."{col}"') for col in cols)
            c["inv_summary"] = conn.execute(
                f"WITH old AS (DELETE FROM inv_summary WHERE {_SUMMARY} RETURNING *) "
                f"INSERT INTO inv_summary ({names}) SELECT {select} FROM old",
                params,
            ).rowcount
        changed = {k: v for k, v in c.items() if v}
        if changed:
            conn.execute(
                "INSERT INTO audit_log (actor, action, target, meta) VALUES (%s, %s, %s, %s::jsonb)",
                (actor, ACTION, f"investigation:{inv}", json.dumps(changed, sort_keys=True)),
            )
    return c


def purge(conn, manifest: dict[str, Any], runs: Optional[sc.ObjectStore], apply: bool, actor: str, reason: str,
          archive_dir: Optional[str] = None, archive_bucket: Optional[str] = None,
          archive_command: Optional[list[str]] = None) -> Counter:
    hits = _by_kind(manifest)
    for k in ("runs_page", "runs_object", "archive_snapshot", "archive_source", "archive_entity"):
        hits.setdefault(k, [])
    total: Counter = Counter()

    plan = archive_plan(conn, hits)
    total.update({f"archive_{k}": len(v) for k, v in plan.items()})
    if apply:
        run_archive_removal(plan, reason, actor, archive_dir, archive_bucket, archive_command)
        total["archive_excerpts_blanked"] = blank_excerpts(conn, sorted({h["source_id"] for h in
                                                                        hits["archive_source"]}), actor)

    if runs is not None:
        total.update(purge_runs(runs, hits, apply))

    exports_by_inv: dict[str, list[str]] = defaultdict(list)
    for e in manifest.get("exports", []):
        if str(e.get("object_path", "")).startswith("runs/"):
            exports_by_inv[e["investigation_id"]].append(e["object_path"])
    for inv in manifest.get("affected", {}).get("investigations", []):
        c = purge_investigation(conn, inv, hits, apply, actor)
        total.update({k: v for k, v in c.items() if v})
        if runs is not None:
            names = set(exports_by_inv.get(inv, [])) | {f"runs/{inv}/{f}" for f in EXPORT_FILES}
            for name in sorted(names):
                if runs.read(name) is not None:
                    total["runs_export_objects"] += 1
                    if apply:
                        runs.delete_all(name)
    return total


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest")
    ap.add_argument("--apply", action="store_true", help="write; without it this is a dry run")
    ap.add_argument("--runs-bucket", default=os.environ.get("RUNS_BUCKET"))
    ap.add_argument("--runs-dir")
    ap.add_argument("--archive-bucket", default=os.environ.get("ARCHIVE_BUCKET"))
    ap.add_argument("--archive-dir")
    ap.add_argument("--actor", default="ops:h211")
    ap.add_argument("--reason", default="content-safety H211")
    args = ap.parse_args(argv)

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL is not set")
    sc.require_detector()
    manifest = sc.load_manifest(args.manifest)
    conn = sc.connect(dsn, read_only=not args.apply)
    runs = sc.open_store(args.runs_bucket, args.runs_dir, read_only=not args.apply)
    if runs is None:
        print("note: no runs store given; runs-bucket objects are not touched", file=sys.stderr)
    total = purge(conn, manifest, runs, args.apply, args.actor, args.reason, args.archive_dir, args.archive_bucket)
    sc.print_table("content-safety purge " + ("(APPLIED):" if args.apply else "(dry run, nothing written):"),
                   {k: v for k, v in total.items() if v})
    if not args.apply:
        print("re-run with --apply to make these changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
