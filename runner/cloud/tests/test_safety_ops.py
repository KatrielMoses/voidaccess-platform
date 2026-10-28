"""safety_scan.py / safety_purge.py (H211): object-store handling, and an end-to-end scan and purge against a local
Postgres seeded with synthetic data and directory-backed object stores.

The end-to-end test needs TEST_DATABASE_URL (a local superuser URL, as for the platform's own suites), psycopg 3,
and pnpm with the platform's node_modules; it is skipped without them. Flagged fixtures are built from the engine's
vocabulary constants, never copied from real data.
"""

from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import safety_common as sc  # noqa: E402
import safety_purge  # noqa: E402
import safety_scan  # noqa: E402

PLATFORM_ROOT = Path(__file__).resolve().parents[3]
cs = pytest.importorskip("utils.content_safety")
if not hasattr(cs, "detect_prohibited"):
    pytest.skip("needs the 2.1.1 engine", allow_module_level=True)

FLAGGED = f"listing {cs.CONTENT_BLOCKLIST[1].replace(' ', '-').upper()} here"
CLEAN = "LockBit affiliate panel and leak site infrastructure notes."
ONION = "http://" + "a" * 56 + ".onion"


def _pages(*texts: str, base: str = ONION) -> bytes:
    return sc.write_pages([
        {"url": f"{base}/{i}", "fetched_at": "2026-10-28T00:00:00Z", "content_hash": sc.sha256(t), "text": t}
        for i, t in enumerate(texts)
    ])


# ---- object stores and the runs-bucket rewrite --------------------------------------------------------------


def test_local_store_versions_and_read_only(tmp_path):
    store = sc.LocalStore(tmp_path)
    store.replace("runs/r/x.json", b"one", "application/json")
    (tmp_path / ".versions/runs/r/x.json").mkdir(parents=True)
    (tmp_path / ".versions/runs/r/x.json/1").write_bytes(b"old")
    assert list(store.list("runs/")) == ["runs/r/x.json"]
    store.replace("runs/r/x.json", b"two", "application/json")
    assert store.read("runs/r/x.json") == b"two"
    assert not any((tmp_path / ".versions/runs/r/x.json").iterdir())
    (tmp_path / ".versions/runs/r/x.json/2").write_bytes(b"old")
    assert store.delete_all("runs/r/x.json") == 2
    assert store.read("runs/r/x.json") is None
    ro = sc.LocalStore(tmp_path, read_only=True)
    with pytest.raises(PermissionError):
        ro.replace("runs/r/y", b"", "x")
    with pytest.raises(PermissionError):
        ro.delete_all("runs/r/y")
    with pytest.raises(ValueError):
        store.read("../escape")


def test_runs_pages_rewrite_dry_run_apply_and_second_run(tmp_path):
    store = sc.LocalStore(tmp_path)
    name = "runs/11111111-1111-4111-8111-111111111111/pages.jsonl.gz"
    store.replace(name, _pages(CLEAN, FLAGGED, CLEAN + " two"), "application/gzip")
    (tmp_path / ".versions" / name).mkdir(parents=True)
    (tmp_path / ".versions" / name / "1").write_bytes(b"older version")
    hits = {"runs_page": [{"object": name}], "runs_object": []}

    dry = safety_purge.purge_runs(sc.LocalStore(tmp_path, read_only=True), hits, apply=False)
    assert dry == {"runs_page_lines": 1, "runs_pages_objects": 1}
    assert len(sc.read_pages(store.read(name))) == 3

    applied = safety_purge.purge_runs(store, hits, apply=True)
    assert applied == dry
    kept = sc.read_pages(store.read(name))
    assert [r["text"] for r in kept] == [CLEAN, CLEAN + " two"]
    assert not any((tmp_path / ".versions" / name).iterdir())
    assert safety_purge.purge_runs(store, hits, apply=True) == {}


def test_gcs_store_replace_deletes_old_generations_and_read_only_refuses():
    import httpx

    calls: list[tuple[str, str]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append((req.method, str(req.url)))
        if req.method == "POST":
            return httpx.Response(200, json={"generation": "3"})
        if req.method == "GET" and "versions=true" in str(req.url):
            return httpx.Response(200, json={"items": [
                {"name": "runs/r/p", "generation": "1"}, {"name": "runs/r/p", "generation": "3"},
                {"name": "runs/r/p2", "generation": "9"},
            ]})
        return httpx.Response(204)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    store = sc.GcsStore("b", token=lambda: "t", client=client)
    store.replace("runs/r/p", b"x", "application/gzip")
    deletes = [u for m, u in calls if m == "DELETE"]
    assert len(deletes) == 1 and "generation=1" in deletes[0]
    ro = sc.GcsStore("b", read_only=True, token=lambda: "t", client=client)
    with pytest.raises(PermissionError):
        ro.delete_all("runs/r/p")


# ---- end to end -----------------------------------------------------------------------------------------------

E2E_DB = "voidaccess_test_safety"


def _e2e_ready() -> str | None:
    if not os.environ.get("TEST_DATABASE_URL"):
        return "TEST_DATABASE_URL not set"
    try:
        import psycopg  # noqa: F401
    except ImportError:
        return "psycopg not installed"
    if not shutil.which("pnpm") or not (PLATFORM_ROOT / "node_modules").is_dir():
        return "pnpm and the platform's node_modules are needed"
    return None


def _url(base: str, db: str, user: str | None = None, password: str | None = None) -> str:
    from urllib.parse import urlsplit, urlunsplit

    u = urlsplit(base)
    netloc = u.hostname or "localhost"
    if u.port:
        netloc += f":{u.port}"
    if user:
        netloc = f"{user}:{password}@{netloc}"
    elif u.username:
        netloc = f"{u.username}{':' + u.password if u.password else ''}@{netloc}"
    return urlunsplit((u.scheme, netloc, f"/{db}", "", ""))


@pytest.fixture(scope="module")
def e2e_db():
    reason = _e2e_ready()
    if reason:
        pytest.skip(reason)
    import psycopg

    admin = os.environ["TEST_DATABASE_URL"]
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {E2E_DB} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {E2E_DB}")
    owner = _url(admin, E2E_DB)
    subprocess.run(
        ["pnpm", "--silent", "--filter", "@voidaccess/db", "db:setup-dev"],
        cwd=PLATFORM_ROOT, env={**os.environ, "MIGRATE_DATABASE_URL": owner}, check=True, capture_output=True,
    )
    yield {
        "owner": owner,
        "app": _url(admin, E2E_DB, "va_app", os.environ.get("VA_APP_LOCAL_PASSWORD", "va_app_local")),
        "system": _url(admin, E2E_DB, "va_worker", os.environ.get("VA_WORKER_LOCAL_PASSWORD", "va_worker_local")),
    }


def _seed(conn, runs_dir: Path, archive_dir: Path) -> dict[str, str]:
    q = conn.execute
    # start from the dev seed's users only: its demo investigations are not this test's data
    q("TRUNCATE investigations, archive_observations, archive_relationship_sources, archive_relationships, "
      "archive_aliases, archive_entities, archive_sources, archive_removed_pages, audit_log CASCADE")
    user = q("SELECT id::text FROM users ORDER BY created_at LIMIT 1").fetchone()[0]
    ids = {k: str(uuid.uuid4()) for k in ("inv_a", "inv_b")}
    for k in ("inv_a", "inv_b"):
        q("INSERT INTO investigations (id, user_id, query, depth, status) VALUES (%s, %s, 'lockbit', 'standard', "
          "'completed')", (ids[k], user))
    a, b = ids["inv_a"], ids["inv_b"]

    def src(inv, bundle, excerpt, url):
        return q("INSERT INTO inv_sources (user_id, investigation_id, bundle_id, kind, name, url, fetched_at, excerpt) "
                 "VALUES (%s,%s,%s,'onion','x.onion',%s,now(),%s) RETURNING id::text",
                 (user, inv, bundle, url, excerpt)).fetchone()[0]

    def ent(inv, bundle, etype, value, sources):
        return q("INSERT INTO inv_entities (user_id, investigation_id, bundle_id, type, value, display_value, "
                 "confidence, source_ids) VALUES (%s,%s,%s,%s,%s,%s,0.9,%s) RETURNING id::text",
                 (user, inv, bundle, etype, value, value, sources)).fetchone()[0]

    ids["src_clean"] = src(a, "src-1", CLEAN, f"{ONION}/clean")
    ids["src_flagged"] = src(a, "src-2", FLAGGED, f"{ONION}/other")
    ids["e_org"] = ent(a, "e1", "ORGANIZATION_NAME", "Acme Corp", ["src-1"])
    ids["e_only_flagged_src"] = ent(a, "e2", "THREAT_ACTOR_HANDLE", "examplehandle", ["src-2"])
    ids["e_url"] = ent(a, "e3", "ONION_URL", f"{ONION}/{cs.CONTENT_BLOCKLIST[1].replace(' ', '_')}", ["src-1"])
    ids["e_ip"] = ent(a, "e4", "IP_ADDRESS", "203.0.113.7", ["src-1", "src-2"])
    ids["e_b"] = ent(b, "e1", "ORGANIZATION_NAME", "Acme Corp", ["src-1"])
    for s, t in (("e1", "e2"), ("e1", "e4")):
        q("INSERT INTO inv_relationships (user_id, investigation_id, source_bundle_id, target_bundle_id, type) "
          "VALUES (%s,%s,%s,%s,'CO_APPEARED_ON')", (user, a, s, t))
    for bundle, ents in (("act-1", ["e2"]), ("act-2", ["e1"])):
        q("INSERT INTO inv_actors (user_id, investigation_id, bundle_id, handle, entity_bundle_ids) "
          "VALUES (%s,%s,%s,'examplehandle',%s)", (user, a, bundle, ents))
    for inv, md in ((a, f"Summary. {FLAGGED}"), (b, "A clean summary.")):
        q("INSERT INTO inv_summary (user_id, investigation_id, markdown, key_findings, confidence) "
          "VALUES (%s,%s,%s,%s::jsonb,'medium')", (user, inv, md, json.dumps(["one finding"])))
    for inv in (a, b):
        q("INSERT INTO inv_exports (user_id, investigation_id, format, object_path, content) "
          "VALUES (%s,%s,'stix',%s,%s)", (user, inv, f"db://inv_exports/{inv}/stix", b'{"type":"bundle"}'))

    # archive: a source whose snapshot is flagged, a source whose excerpt is flagged, a flagged URL entity
    snap_text = f"snapshot text {FLAGGED}"
    snap_hash = sc.sha256(snap_text)
    snap_key = f"pages/{snap_hash}.txt.gz"
    (archive_dir / "pages").mkdir(parents=True)
    (archive_dir / snap_key).write_bytes(gzip.compress(snap_text.encode()))
    ids["snap_hash"] = snap_hash
    ids["arch_snap"] = q("INSERT INTO archive_sources (url, first_seen, last_seen, content_hash, snapshot_path, excerpt) "
                         "VALUES (%s, now(), now(), %s, %s, %s) RETURNING id::text",
                         (f"{ONION}/snap", snap_hash, snap_key, CLEAN)).fetchone()[0]
    ids["arch_excerpt"] = q("INSERT INTO archive_sources (url, first_seen, last_seen, excerpt) "
                            "VALUES (%s, now(), now(), %s) RETURNING id::text", (f"{ONION}/ex", FLAGGED)).fetchone()[0]
    ids["arch_entity"] = q("INSERT INTO archive_entities (type, canonical_value, display_value, first_seen, last_seen) "
                           "VALUES ('ONION_URL', %s, %s, now(), now()) RETURNING id::text",
                           (f"{ONION}/{cs.CONTENT_BLOCKLIST[1].replace(' ', '-')}",) * 2).fetchone()[0]
    q("INSERT INTO archive_entities (type, canonical_value, display_value, first_seen, last_seen) "
      "VALUES ('ORGANIZATION_NAME', 'acmecorp', 'Acme Corp', now(), now())")

    runs = sc.LocalStore(runs_dir)
    runs.replace(f"runs/{a}/pages.jsonl.gz", _pages(CLEAN, FLAGGED), "application/gzip")
    runs.replace(f"runs/{a}/bundle.json", json.dumps({"summary": {"markdown": FLAGGED}}).encode(), "application/json")
    runs.replace(f"runs/{a}/stix.json", b'{"type":"bundle"}', "application/json")
    runs.replace(f"runs/{b}/pages.jsonl.gz", _pages(CLEAN), "application/gzip")
    runs.replace(f"runs/{b}/stix.json", b'{"type":"bundle"}', "application/json")
    return ids


def _count(conn, sql: str, *params) -> int:
    return conn.execute(sql, params or None).fetchone()[0]


def test_scan_and_purge_end_to_end(e2e_db, tmp_path, monkeypatch):
    runs_dir, archive_dir = tmp_path / "runs", tmp_path / "archive"
    runs_dir.mkdir()
    owner = sc.connect(e2e_db["owner"], read_only=False)
    ids = _seed(owner, runs_dir, archive_dir)
    a, b = ids["inv_a"], ids["inv_b"]

    # ---- scan: read-only session, read-only stores, no text in the manifest
    ro = sc.connect(e2e_db["owner"], read_only=True)
    import psycopg

    with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
        ro.execute("INSERT INTO audit_log (actor, action) VALUES ('x', 'y')")
    manifest = safety_scan.scan(ro, sc.LocalStore(runs_dir, True), sc.LocalStore(archive_dir, True))
    assert manifest["counts"] == {
        "runs_page": 1, "runs_object": 1, "archive_snapshot": 1, "archive_source": 1, "archive_entity": 1,
        "inv_source": 1, "inv_entity": 1, "inv_summary": 1,
    }
    assert manifest["affected"] == {"investigations": [a], "runs": [a]}
    assert [e["investigation_id"] for e in manifest["exports"]] == [a]
    blob = json.dumps(manifest)
    norm = cs.normalize_for_safety(FLAGGED)
    for needle in (FLAGGED, cs.CONTENT_BLOCKLIST[1], norm[0], norm[1], "listing", CLEAN):
        assert needle not in blob
    path = tmp_path / "manifest.json"
    path.write_text(blob)
    manifest = sc.load_manifest(path)

    def snapshot() -> dict:
        tables = ["inv_sources", "inv_entities", "inv_relationships", "inv_actors", "inv_exports", "audit_log",
                  "archive_removed_pages"]
        state = {t: _count(owner, f"SELECT count(*) FROM {t}") for t in tables}
        state["tombstoned"] = _count(owner, "SELECT count(*) FROM archive_sources WHERE tombstoned_at IS NOT NULL")
        state["notice"] = _count(owner, "SELECT count(*) FROM inv_summary WHERE markdown = %s", sc.SUMMARY_NOTICE)
        state["files"] = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*") if p.is_file())
        state["pages_a"] = sc.read_pages((runs_dir / f"runs/{a}/pages.jsonl.gz").read_bytes()) \
            if (runs_dir / f"runs/{a}/pages.jsonl.gz").exists() else None
        return state

    # ---- dry run (the default): nothing changes
    before = snapshot()
    plan = safety_purge.purge(ro, manifest, sc.LocalStore(runs_dir, True), apply=False, actor="ops:test",
                              reason="test")
    assert plan["inv_sources"] == 1 and plan["inv_entities"] == 2 and plan["inv_exports"] == 1
    assert plan["archive_pages"] == 1 and plan["archive_sources"] == 1 and plan["archive_entities"] == 1
    assert snapshot() == before

    # ---- apply
    monkeypatch.setenv("ARCHIVE_DATABASE_URL", e2e_db["app"])
    monkeypatch.setenv("ARCHIVE_DATABASE_URL_SYSTEM", e2e_db["system"])
    applied = safety_purge.purge(owner, manifest, sc.LocalStore(runs_dir), apply=True, actor="ops:test",
                                 reason="test", archive_dir=str(archive_dir))
    assert applied["inv_relationships"] == 1 and applied["inv_actors"] == 1 and applied["inv_summary"] == 1

    remaining = {r[0] for r in owner.execute("SELECT id::text FROM inv_entities")}
    assert remaining == {ids["e_org"], ids["e_ip"], ids["e_b"]}
    assert {r[0] for r in owner.execute("SELECT id::text FROM inv_sources")} == {ids["src_clean"]}
    assert _count(owner, "SELECT count(*) FROM inv_relationships WHERE investigation_id = %s", a) == 1
    assert _count(owner, "SELECT count(*) FROM inv_actors WHERE investigation_id = %s", a) == 1
    md, kf, rn = owner.execute("SELECT markdown, key_findings, risk_notes FROM inv_summary WHERE investigation_id = %s",
                               (a,)).fetchone()
    assert (md, kf, rn) == (sc.SUMMARY_NOTICE, [], [])
    assert owner.execute("SELECT markdown FROM inv_summary WHERE investigation_id = %s", (b,)).fetchone()[0] \
        == "A clean summary."
    assert _count(owner, "SELECT count(*) FROM inv_exports WHERE investigation_id = %s", a) == 0
    assert _count(owner, "SELECT count(*) FROM inv_exports WHERE investigation_id = %s", b) == 1
    audits = owner.execute("SELECT target, meta FROM audit_log WHERE action = 'content_safety_purge'").fetchall()
    assert {t for t, _ in audits} == {f"investigation:{a}", "archive"}
    assert all(all(isinstance(v, int) for v in m.values()) for _, m in audits)  # counts only

    assert not (archive_dir / f"pages/{ids['snap_hash']}.txt.gz").exists()
    assert _count(owner, "SELECT count(*) FROM archive_removed_pages WHERE content_hash = %s", ids["snap_hash"]) == 1
    tomb, excerpt = owner.execute("SELECT tombstoned_at IS NOT NULL, excerpt FROM archive_sources WHERE id = %s",
                                  (ids["arch_excerpt"],)).fetchone()
    assert tomb and excerpt == ""
    assert _count(owner, "SELECT count(*) FROM archive_entities WHERE id = %s AND tombstoned_at IS NOT NULL",
                  ids["arch_entity"]) == 1
    assert _count(owner, "SELECT count(*) FROM audit_log WHERE action = 'archive.remove'") == 3

    assert [r["text"] for r in sc.read_pages((runs_dir / f"runs/{a}/pages.jsonl.gz").read_bytes())] == [CLEAN]
    assert not (runs_dir / f"runs/{a}/bundle.json").exists()
    assert not (runs_dir / f"runs/{a}/stix.json").exists()
    assert (runs_dir / f"runs/{b}/stix.json").exists()
    assert (runs_dir / f"runs/{b}/pages.jsonl.gz").exists()

    # ---- a second run changes nothing, and a new scan finds nothing
    after = snapshot()
    again = safety_purge.purge(owner, manifest, sc.LocalStore(runs_dir), apply=True, actor="ops:test",
                               reason="test", archive_dir=str(archive_dir))
    assert {k: v for k, v in again.items() if v} == {}
    assert snapshot() == after
    rescan = safety_scan.scan(ro, sc.LocalStore(runs_dir, True), sc.LocalStore(archive_dir, True))
    assert rescan["counts"] == {}


def test_cli_defaults_to_dry_run_and_read_only(e2e_db, tmp_path, monkeypatch, capsys):
    manifest = {"manifest_version": sc.MANIFEST_VERSION, "hits": [], "affected": {"investigations": [], "runs": []},
                "exports": []}
    path = tmp_path / "m.json"
    path.write_text(json.dumps(manifest))
    seen: dict = {}
    real = sc.connect

    def spy(dsn, read_only):
        seen["read_only"] = read_only
        return real(dsn, read_only)

    monkeypatch.setattr(sc, "connect", spy)
    monkeypatch.setenv("DATABASE_URL", e2e_db["owner"])
    assert safety_purge.main([str(path), "--runs-dir", str(tmp_path)]) == 0
    assert seen["read_only"] is True
    assert "dry run" in capsys.readouterr().out
    assert safety_scan.main(["--out", str(tmp_path / "scan.json"), "--runs-dir", str(tmp_path),
                             "--archive-dir", str(tmp_path)]) == 0
    assert seen["read_only"] is True
