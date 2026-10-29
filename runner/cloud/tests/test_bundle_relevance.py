"""Contract v0.4: the engine's 22R relevance tiers are carried into the bundle.

The CLI payload is shaped like a real 22R run's JSON (engine 964100a): `pages_scraped[]` with `page_id` null and
`relevance` / `relevance_reason` / `page_kind`, entities and relationships with `relevance`, and the top-level
`relevance` block. The page texts are invented. Needs the engine on PYTHONPATH (its models and sanitizer).
"""

import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

pytest.importorskip("db.models", reason="engine tree not on PYTHONPATH")
pytest.importorskip("sanitizer.gate", reason="engine tree not on PYTHONPATH")

NOW = datetime(2026, 10, 29, 7, 0, 0, tzinfo=timezone.utc)
URL_DIRECT = "http://redlinemarketexampleaddr234567abcdef.onion/listing/7"
URL_BACKGROUND = "https://news.example.org/2026/10/weekly-roundup"
URL_RELATED = "https://forum.example.net/thread/991"
URL_UNSAFE = "http://flaggedexampleaddress234567.onion/x"
METRICS = {
    "duration_ms": 1.0, "tor_bootstrap_ms": 1.0, "stage_ms": {}, "llm_calls": 0, "llm_tokens_in": 0,
    "llm_tokens_out": 0, "llm_cost_usd": 0.0, "pages_fetched": 4, "bytes_fetched": 10, "enrichment_calls": {},
}


@pytest.fixture(scope="module")
def run():
    d = tempfile.mkdtemp(prefix="va-relevance-test-")
    db_path = Path(d) / "investigations.db"
    os.environ["VOIDACCESS_DB_PATH"] = str(db_path)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ["HOME"] = d
    os.environ["VOIDACCESS_PRIVATE_MODE"] = "1"

    from db.models import Entity, EntityRelationship, Page
    from db.session import get_session
    from utils.content_safety import CONTENT_BLOCKLIST
    from voidaccess_cli.adapters import sqlite as sa

    sa.init_db()
    inv = str(sa.save_investigation("redline stealer", "redline stealer", "test-model", "completed"))
    inv_uuid = uuid.UUID(inv)
    pages = {k: uuid.uuid4() for k in ("direct", "background", "related", "unsafe")}
    texts = {
        "direct": "RedLine stealer logs for sale. Panel build 2026. " + "Seller notes about the build. " * 30,
        "background": "Weekly security roundup. The FBI and CISA published guidance. " + "Unrelated news. " * 30,
        "related": "A thread about infostealer panels in general. " + "Forum chatter. " * 30,
        "unsafe": ("benign context. " * 40) + f" {CONTENT_BLOCKLIST[0]} " + ("more context. " * 40),
    }
    urls = {"direct": URL_DIRECT, "background": URL_BACKGROUND, "related": URL_RELATED, "unsafe": URL_UNSAFE}
    e: dict[str, uuid.UUID] = {}
    with get_session() as s:
        for k, pid in pages.items():
            s.add(Page(id=pid, url=urls[k], cleaned_text=texts[k], scrape_timestamp=NOW, byte_size=len(texts[k])))
        s.flush()

        def ent(name, page, etype, value, conf):
            eid = uuid.uuid4()
            e[name] = eid
            s.add(Entity(
                id=eid, page_id=pages[page], investigation_id=inv_uuid, entity_type=etype, value=value,
                canonical_value=value, confidence=conf, context_snippet="ctx", extraction_method="regex",
                first_seen=NOW, last_seen=NOW, created_at=NOW,
            ))

        ent("redline", "direct", "MALWARE_FAMILY", "RedLine", 0.6)
        ent("btc", "direct", "BITCOIN_ADDRESS", "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", 0.7)
        ent("fbi", "background", "ORGANIZATION_NAME", "FBI", 0.95)
        ent("cisa", "background", "ORGANIZATION_NAME", "CISA", 0.9)
        ent("panel", "related", "DOMAIN", "panel.example.net", 0.5)
        ent("redline_bg", "background", "MALWARE_FAMILY", "redline", 0.99)  # same value as `redline`: merges
        ent("unsafe", "unsafe", "DOMAIN", "blocked-page.example", 0.9)
        s.flush()
        for a, b, pg in (("redline", "btc", "direct"), ("fbi", "cisa", "background"), ("btc", "panel", "direct")):
            s.add(EntityRelationship(
                id=uuid.uuid4(), entity_a_id=e[a], entity_b_id=e[b], relationship_type="CO_APPEARED_ON",
                source_page_id=pages[pg], confidence=0.8, first_seen=NOW, investigation_id=inv_uuid,
            ))

    tiers = {
        "redline": ("direct", "query_entity"), "btc": ("direct", "near_direct_match"),
        "fbi": ("background", "agency_not_near_match"), "cisa": ("background", "agency_not_near_match"),
        "panel": ("related", "related_page"), "redline_bg": ("background", "none"), "unsafe": ("background", "none"),
    }
    by_id = {str(v): k for k, v in e.items()}
    entities = []
    for x in sa.get_entities(inv):
        tier, reason = tiers[by_id[str(x["id"])]]
        entities.append({**x, "relevance": tier, "relevance_reason": reason})
    rel_tiers = {("redline", "btc"): "direct", ("fbi", "cisa"): "background", ("btc", "panel"): "related"}
    rels = []
    for r in sa.get_relationships(inv):
        key = (by_id[str(r["entity_a_id"])], by_id[str(r["entity_b_id"])])
        rels.append({**r, "relevance": rel_tiers[key]})
    cli = {
        "id": inv, "query": "redline stealer", "refined_query": "redline stealer logs", "summary": "# Summary\n",
        "summary_kind": "llm", "entities": entities, "relationships": rels, "communities": {},
        "pages_scraped": [
            {"page_id": None, "url": URL_DIRECT, "source": "tor_search", "relevance": "direct",
             "relevance_reason": "term_match:redline", "page_kind": "market_listing"},
            {"page_id": None, "url": URL_BACKGROUND, "source": "rss", "relevance": "background",
             "relevance_reason": "none", "page_kind": "feed_item"},
            {"page_id": None, "url": URL_RELATED, "source": "clearnet", "relevance": "related",
             "relevance_reason": "refined_term", "page_kind": "brand_new_kind"},
            {"page_id": None, "url": URL_UNSAFE, "source": "tor_search", "relevance": "direct",
             "relevance_reason": "term_match:redline", "page_kind": "other"},
        ],
        "relevance": {
            "query_intent": "named_threat",
            "pages": {"direct": 2, "related": 1, "background": 1},
            "entities": {"direct": 2, "related": 1, "background": 4},
            "relationships": {"direct": 1, "related": 1, "background": 1},
            "removed": {"gazetteer_context": 2, "org_boilerplate": 1},
            "feed_items_capped": 169,
            "filter_fallback": False,
            "refined_query_restored": True,
        },
    }
    return {"db": db_path, "cli": cli, "ids": e}


def _build(run, cli):
    from cloud.bundle import BundleInputs, build_bundle, scrub_bundle

    built = build_bundle(BundleInputs(
        run_id="5a0c3f7e-2b1d-4c3a-9e8f-7a6b5c4d3e2f", query="redline stealer", depth="quick",
        started_at="2026-10-29T07:00:00+00:00", completed_at="2026-10-29T07:03:00+00:00",
        engine_version="2.1.1", metrics=dict(METRICS), cli_payload=cli, db_path=run["db"],
    ))
    return scrub_bundle(built.bundle, built.raw)


@pytest.fixture(scope="module")
def bundle(run):
    return _build(run, run["cli"])


def _strip_tiers(cli):
    out = {k: v for k, v in cli.items() if k != "relevance"}
    drop = ("relevance", "relevance_reason", "page_kind")
    for key in ("entities", "relationships", "pages_scraped"):
        out[key] = [{k: v for k, v in x.items() if k not in drop} for x in cli[key]]
    return out


def test_tiered_bundle_validates(bundle):
    from cloud.bundle import integrity_problems
    from cloud.spec import schema_errors

    assert schema_errors("ResultBundle", bundle) == []
    assert integrity_problems(bundle) == []


def test_sources_carry_tier_reason_and_page_kind_matched_by_url(bundle):
    by_url = {s["url"]: s for s in bundle["sources"]}
    assert by_url[URL_DIRECT]["relevance"] == "direct"
    assert by_url[URL_DIRECT]["relevance_reason"] == "term_match:redline"
    assert by_url[URL_DIRECT]["page_kind"] == "market_listing"
    assert by_url[URL_BACKGROUND]["relevance"] == "background"
    assert by_url[URL_BACKGROUND]["page_kind"] == "feed_item"
    assert by_url[URL_RELATED]["page_kind"] == "other"  # an unknown kind from a newer engine maps to `other`
    assert URL_UNSAFE not in by_url  # the safety gate still drops the page, tier or not


def test_entities_carry_tiers_and_a_merge_keeps_the_strongest(bundle, run):
    ents = {e["value"].lower(): e for e in bundle["entities"]}
    assert ents["redline"]["relevance"] == "direct"
    assert ents["redline"]["relevance_reason"] == "query_entity"
    assert ents["fbi"]["relevance"] == "background"
    assert ents["fbi"]["relevance_reason"] == "agency_not_near_match"
    assert ents["panel.example.net"]["relevance"] == "related"
    assert "blocked-page.example" not in ents
    # Direct first, then Related, then Background (confidence order inside a tier), so the cap keeps Direct
    order = [e["relevance"] for e in bundle["entities"]]
    assert order == sorted(order, key=("direct", "related", "background").index)


def test_relationships_carry_tiers_never_stronger_than_their_ends(bundle):
    tier = {e["id"]: e["relevance"] for e in bundle["entities"]}
    rank = {"direct": 0, "related": 1, "background": 2}
    assert {r["relevance"] for r in bundle["relationships"]} == {"direct", "related", "background"}
    for r in bundle["relationships"]:
        assert rank[r["relevance"]] >= max(rank[tier[r["source"]]], rank[tier[r["target"]]])


def test_summary_counts_are_what_the_bundle_holds_and_flags_are_the_engines(bundle):
    rel = bundle["relevance"]
    assert rel["query_intent"] == "named_threat"
    assert rel["pages"] == {"direct": 1, "related": 1, "background": 1}  # the unsafe page is gone
    assert rel["entities"] == {"direct": 2, "related": 1, "background": 2}  # merged + dropped values are gone
    assert sum(rel["relationships"].values()) == len(bundle["relationships"])
    assert rel["removed"] == {"gazetteer_context": 2, "org_boilerplate": 1}
    assert rel["feed_items_capped"] == 169
    assert rel["filter_fallback"] is False and rel["refined_query_restored"] is True


def test_a_reason_is_bounded_and_markup_is_left_out(run):
    cli = dict(run["cli"])
    cli["pages_scraped"] = [dict(p) for p in cli["pages_scraped"]]
    cli["pages_scraped"][0]["relevance_reason"] = "term_match:" + "x" * 300
    cli["pages_scraped"][1]["relevance_reason"] = "<script>"
    b = _build(run, cli)
    by_url = {s["url"]: s for s in b["sources"]}
    assert len(by_url[URL_DIRECT]["relevance_reason"]) == 120
    assert "relevance_reason" not in by_url[URL_BACKGROUND]
    assert by_url[URL_BACKGROUND]["relevance"] == "background"


def test_an_engine_without_tiers_gives_the_same_bundle_as_before(run):
    from cloud.spec import schema_errors

    b = _build(run, _strip_tiers(run["cli"]))
    assert schema_errors("ResultBundle", b) == []
    assert "relevance" not in b
    for item in b["entities"] + b["sources"] + b["relationships"]:
        assert not {"relevance", "relevance_reason", "page_kind"} & set(item)
    confidences = [e["confidence"] for e in b["entities"]]
    assert confidences == sorted(confidences, reverse=True)  # the pre-2.2 order


def test_an_unknown_tier_value_is_left_out_rather_than_failing_the_run(run):
    from cloud.spec import schema_errors

    cli = dict(run["cli"])
    cli["entities"] = [{**x, "relevance": "noise"} for x in cli["entities"]]
    b = _build(run, cli)
    assert schema_errors("ResultBundle", b) == []
    assert all("relevance" not in e for e in b["entities"])
    assert b["relevance"]["entities"] == {"direct": 0, "related": 0, "background": 0}
