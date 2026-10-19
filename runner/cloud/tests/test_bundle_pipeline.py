"""The bundle builder, exports and page archive on a fixture run with planted credentials (guarantee 5).

Needs the engine (v2.1.0) on PYTHONPATH: it builds the run's SQLite database with the engine's own models,
and uses the engine's sanitizer and exporters.
"""

import gzip
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

pytest.importorskip("db.models", reason="engine tree not on PYTHONPATH")
pytest.importorskip("sanitizer.gate", reason="engine tree not on PYTHONPATH")

AWS = "AKIAIOSFODNN7EXAMPLE"
GH = "ghp_" + "Zq81AbCdEfGh0123456789IjKlMnOpQrSt"[:36]
PASSWORD = "hunter2hunter2"
EMAIL = "jane.roe@victim-corp.example"
PHONE = "+1 415 555 0132"
NAME = "Jane Roe"
PLANTED = [AWS, GH, PASSWORD, EMAIL, "415 555 0132", NAME]
BLOCKED_DOMAIN = "blocked-page.example"

NOW = datetime(2026, 10, 12, 8, 0, 0, tzinfo=timezone.utc)


def _uid():
    return uuid.uuid4()


@pytest.fixture(scope="module")
def run():
    d = tempfile.mkdtemp(prefix="va-bundle-test-")
    db_path = Path(d) / "investigations.db"
    os.environ["VOIDACCESS_DB_PATH"] = str(db_path)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ["HOME"] = d
    os.environ["VOIDACCESS_PRIVATE_MODE"] = "1"

    from db.models import ActorAlias, ActorProfile, Entity, EntityRelationship, Page
    from db.session import get_session
    from utils.content_safety import CONTENT_BLOCKLIST
    from voidaccess_cli.adapters import sqlite as sa

    sa.init_db()
    inv = str(sa.save_investigation("lockbit ransomware", "lockbit ransomware", "test-model", "completed"))
    inv_uuid = uuid.UUID(inv)

    page_a, page_b, page_c, page_d = _uid(), _uid(), _uid(), _uid()
    text_a = (
        "Leak post by LockBit affiliate. Contact " + EMAIL + " or call " + PHONE + ". "
        "Affiliate " + NAME + " shared that the password is " + PASSWORD + " and the key " + AWS + ". "
        "Token " + GH + " was exposed. CVE-2024-3400 is exploited. " + "Normal prose about ransomware. " * 40
    )
    text_b = "LockBit group listing on the leak site. CVE-2024-3400 mentioned again. " + "More benign text. " * 40
    text_c = ("benign context. " * 40) + f" {CONTENT_BLOCKLIST[0]} " + ("more context. " * 40)
    text_d = "An image gallery page. " * 20
    e = {}
    with get_session() as s:
        for pid, url, text in (
            (page_a, "https://github.com/acme/leak-notes", text_a),
            (page_b, "http://lockbitexampleaddress2345abcdef.onion/post/1", text_b),
            (page_c, "http://flaggedexampleaddress234567.onion/x", text_c),
            (page_d, "https://cdn.example.test/gallery/photo.png", text_d),
        ):
            s.add(Page(id=pid, url=url, cleaned_text=text, scrape_timestamp=NOW, byte_size=len(text)))
        s.flush()

        def ent(name, page, etype, value, conf=0.9, method="regex"):
            eid = _uid()
            e[name] = eid
            s.add(
                Entity(
                    id=eid, page_id=page, investigation_id=inv_uuid, entity_type=etype, value=value,
                    canonical_value=value, confidence=conf, context_snippet=f"context mentions {value} here",
                    extraction_method=method, first_seen=NOW, last_seen=NOW, created_at=NOW,
                )
            )

        ent("lockbit", page_b, "RANSOMWARE_GROUP", "LockBit")
        ent("aws", page_a, "AWS_ACCESS_KEY", AWS)
        ent("gh", page_a, "GITHUB_TOKEN", GH)
        ent("combo", page_a, "COMBO_LIST_ENTRY", f"{EMAIL}:{PASSWORD}")
        ent("email", page_a, "EMAIL_ADDRESS", EMAIL)
        ent("phone", page_a, "PHONE_NUMBER", PHONE)
        ent("name", page_a, "PERSON_NAME", NAME)
        ent("cve_a", page_a, "CVE_NUMBER", "CVE-2024-3400", 0.7)
        ent("cve_b", page_b, "CVE_NUMBER", "CVE-2024-3400", 0.8)
        ent("evil", page_c, "DOMAIN", BLOCKED_DOMAIN)
        ent("weird", page_a, "SPACESHIP", "warp-core")
        s.flush()
        for a, b, t, pg in (
            ("lockbit", "cve_b", "EXPLOITS", page_b),
            ("lockbit", "email", "CO_APPEARED_ON", page_a),
            ("cve_a", "cve_b", "CO_APPEARED_ON", page_a),  # merges into a self-loop: must be dropped
            ("lockbit", "evil", "CO_APPEARED_ON", page_c),  # the other end was dropped
        ):
            s.add(EntityRelationship(id=_uid(), entity_a_id=e[a], entity_b_id=e[b], relationship_type=t, source_page_id=pg, confidence=0.8, first_seen=NOW, investigation_id=inv_uuid))
        actor = ActorProfile(id=_uid(), canonical_handle="lockbit", first_seen_at=NOW, last_seen_at=NOW, investigation_count=1)
        s.add(actor)
        s.flush()
        s.add(ActorAlias(id=_uid(), actor_id=actor.id, alias_value="LockBit3.0", alias_type="forum_handle"))
        s.add(ActorAlias(id=_uid(), actor_id=actor.id, alias_value="lockbit-support@protonmail.com", alias_type="email"))

    entities = sa.get_entities(inv)
    rels = sa.get_relationships(inv)
    summary = (
        "# Threat summary\n1. Input Query: lockbit ransomware\n2. Source Links Referenced for Analysis\n"
        "- https://github.com/acme/leak-notes\n4. Key Insights\n"
        f"- LockBit exploits CVE-2024-3400 per the leak post.\n- The affiliate {EMAIL} leaked the password {PASSWORD}.\n"
        f"5. Next Steps\n- Rotate {AWS}.\n"
    )
    cli = {
        "id": inv, "query": "lockbit ransomware", "refined_query": "lockbit ransomware", "summary": summary,
        "summary_kind": "llm", "entities": entities, "relationships": rels,
        "communities": {x["id"]: (i % 2) for i, x in enumerate(entities)},
        "pages_scraped": [
            {"page_id": str(page_a), "url": "https://github.com/acme/leak-notes", "source": "github"},
            {"page_id": str(page_b), "url": "http://lockbitexampleaddress2345abcdef.onion/post/1", "source": "tor_search"},
        ],
        "sources_used": {"rdap": {"status": "ok", "count": 2}, "nvd": {"status": "skipped"}},
    }
    yield {"db": db_path, "cli": cli, "inv": inv, "entities": entities, "ids": e, "pages": (page_a, page_b, page_c, page_d)}


@pytest.fixture(scope="module")
def built(run):
    from cloud.bundle import BundleInputs, build_bundle

    return build_bundle(
        BundleInputs(
            run_id="0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5d", query="lockbit ransomware", depth="quick",
            started_at="2026-10-12T08:00:00+00:00", completed_at="2026-10-12T08:04:00+00:00",
            engine_version="bf2213c", metrics={
                "duration_ms": 1.0, "tor_bootstrap_ms": 1.0, "stage_ms": {}, "llm_calls": 0, "llm_tokens_in": 0,
                "llm_tokens_out": 0, "llm_cost_usd": 0.0, "pages_fetched": 4, "bytes_fetched": 10, "enrichment_calls": {},
            },
            cli_payload=run["cli"], db_path=run["db"],
        )
    )


def text_of(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)


def test_bundle_validates_against_the_schema_and_is_consistent(built):
    from cloud.bundle import integrity_problems, scrub_bundle
    from cloud.spec import schema_errors

    b = scrub_bundle(built.bundle, built.raw)
    assert schema_errors("ResultBundle", b) == []
    assert integrity_problems(b) == []
    assert b["schema_version"] == 1 and b["depth"] == "quick"


def test_an_excerpt_at_the_cap_still_validates_when_masking_makes_it_longer(built):
    """R2b root cause: a 500-character excerpt holding a 5-character secret grew to 505 when the secret was replaced
    by `[redacted]`, the bundle failed `sources/0/excerpt: maxLength` and the run ended `failed: error`."""
    import copy

    from cloud import constants as C
    from cloud.bundle import RawSecrets, scrub_bundle
    from cloud.spec import schema_errors

    raw = copy.deepcopy(built.raw)
    raw.add("pw123", "[redacted]")
    bundle = copy.deepcopy(built.bundle)
    excerpt = ("pw123 " * 100)[: C.EXCERPT_MAX_CHARS]
    assert len(excerpt) == C.EXCERPT_MAX_CHARS
    bundle["sources"][0]["excerpt"] = excerpt
    assert len(RawSecrets.replace_pairs(raw, excerpt)) > C.EXCERPT_MAX_CHARS  # the failure mode is real

    out = scrub_bundle(bundle, raw)
    assert schema_errors("ResultBundle", out) == []
    assert len(out["sources"][0]["excerpt"]) <= C.EXCERPT_MAX_CHARS and "pw123" not in out["sources"][0]["excerpt"]


def test_planted_credentials_do_not_survive_anywhere_in_the_bundle(built):
    from cloud.bundle import scrub_bundle

    flat = text_of(scrub_bundle(built.bundle, built.raw))
    for planted in PLANTED:
        assert planted not in flat, f"{planted!r} leaked into the bundle"


def test_secrets_are_len_and_sha_prefix_only_and_sensitive_is_flagged(built):
    by_type = {}
    for e in built.bundle["entities"]:
        by_type.setdefault(e["type"], []).append(e)
    for t in ("AWS_ACCESS_KEY", "GITHUB_TOKEN", "COMBO_LIST_ENTRY"):
        (e,) = by_type[t]
        assert e["sensitive"] is True
        assert e["value"].startswith("len:") and " sha256:" in e["value"] and len(e["value"].split("sha256:")[1]) == 8
        assert e["display_value"].startswith("len:") and "sha256" not in e["display_value"]
    (email,) = by_type["EMAIL_ADDRESS"]
    assert email["sensitive"] and email["display_value"] == "j***@victim-corp.example" and email["value"] == email["display_value"]
    assert any(t.startswith("fp:") and len(t) == 11 for t in email["tags"])
    (phone,) = by_type["PHONE_NUMBER"]
    assert phone["display_value"] == "+***32"
    (person,) = by_type["PERSON_NAME"]
    assert person["display_value"] == "J*** R***"
    (cve,) = by_type["CVE_NUMBER"]
    assert not cve["sensitive"] and cve["value"] == "CVE-2024-3400"


def test_duplicates_merge_unknown_types_and_flagged_pages_are_dropped(built):
    b = built.bundle
    cves = [e for e in b["entities"] if e["type"] == "CVE_NUMBER"]
    assert len(cves) == 1 and len(cves[0]["source_ids"]) == 2 and cves[0]["confidence"] == pytest.approx(0.8, abs=0.3)
    assert built.dropped_entities == {"SPACESHIP": 1}
    assert b["metrics"]["dropped_entities"] == {"SPACESHIP": 1}
    flat = text_of(b)
    assert BLOCKED_DOMAIN not in flat and "flaggedexample" not in flat  # entity and source of the flagged page
    assert "photo.png" not in flat  # media URL is not a source


def test_sources_are_text_pages_with_sanitized_short_excerpts(built):
    kinds = {s["url"]: s["kind"] for s in built.bundle["sources"]}
    assert kinds == {
        "https://github.com/acme/leak-notes": "code_forge",
        "http://lockbitexampleaddress2345abcdef.onion/post/1": "onion_page",
    }
    for s in built.bundle["sources"]:
        assert 0 < len(s["excerpt"]) <= 500 and s["fetched_at"].endswith("+00:00")
    assert "CREDENTIAL_PRESENT" in "".join(s["excerpt"] for s in built.bundle["sources"]) or PASSWORD not in text_of(built.bundle["sources"])


def test_relationships_drop_self_loops_and_edges_to_dropped_entities(built):
    types = sorted(r["type"] for r in built.bundle["relationships"])
    assert types == ["CO_APPEARED_ON", "EXPLOITS"]
    for r in built.bundle["relationships"]:
        assert r["evidence_source_ids"] and 0 <= r["weight"] <= 1


def test_actors_communities_and_summary(built):
    (actor,) = built.bundle["actors"]
    assert actor["handle"] == "LockBit" and actor["aliases"] == ["LockBit3.0"]  # the email alias is not carried
    assert built.bundle["communities"] and all(c["entity_ids"] for c in built.bundle["communities"])
    sm = built.bundle["summary"]
    assert sm["summary_kind"] == "llm" and sm["source_count"] == 2 and sm["confidence"] == "low"
    assert len(sm["key_findings"]) == 2 and "LockBit exploits CVE-2024-3400" in sm["key_findings"][0]
    assert all(PASSWORD not in x and EMAIL not in x for x in sm["key_findings"] + [sm["markdown"]])


def test_pages_archive_has_only_sanitized_text_and_no_dropped_pages(built):
    from cloud.archive import build_pages_archive

    raw = gzip.decompress(build_pages_archive({p: built.raw.replace_pairs(t) for p, t in built.sanitized_pages.items()}, built.page_rows))
    lines = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
    assert len(lines) == 2
    for line in lines:
        assert set(line) == {"url", "fetched_at", "content_hash", "text"} and len(line["content_hash"]) == 64
    for planted in PLANTED:
        assert planted not in raw.decode("utf-8"), f"{planted!r} leaked into pages.jsonl.gz"
    assert "photo.png" not in raw.decode("utf-8") and "flagged" not in raw.decode("utf-8")


def test_exports_are_redacted_and_a_failing_exporter_is_skipped_with_a_reason(run, built, monkeypatch):
    from cloud import exports

    assert exports.redact_local_db(run["db"], built.raw) > 0
    out, errors = exports.build_exports(run["inv"], "run-1", "lockbit ransomware", built.raw)
    assert errors == {} and set(out) == set(exports.EXPORT_FORMATS)
    for fmt, data in out.items():
        text = data.decode("utf-8")
        for planted in PLANTED:
            assert planted not in text, f"{planted!r} leaked into the {fmt} export"
    assert any(b"LockBit" in d or b"CVE-2024-3400" in d for d in out.values())

    monkeypatch.setattr("export.sigma.render_sigma_rules", lambda *a, **k: (_ for _ in ()).throw(ValueError("rule exploded")))
    monkeypatch.setattr("export.render_sigma_rules", lambda *a, **k: (_ for _ in ()).throw(ValueError("rule exploded")))
    out2, errors2 = exports.build_exports(run["inv"], "run-1", "lockbit ransomware", built.raw)
    assert errors2 == {"sigma": "ValueError"} and "sigma" not in out2 and "stix" in out2
