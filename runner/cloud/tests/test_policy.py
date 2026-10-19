import os

import pytest

from cloud import policy

ENV_KEYS = [
    "VA_CLOUD_POLICY", "VOIDACCESS_PRIVATE_MODE", "VOIDACCESS_SAFETY_BYPASS_PROMPT", "PLAYWRIGHT_ENABLED",
    "MEILI_HOST", "MEILI_MASTER_KEY", "VOIDACCESS_DISABLE_CONTENT_SAFETY", "VOIDACCESS_PACE", "CHROMA_PERSIST_DIR",
    "MAX_LLM_PAGES_PER_INV", "MAX_REL_PAGES_PER_INV", "PASTE_MAX_RESULTS", "ENABLE_RELATIONSHIP_EXTRACTION",
    "VOIDACCESS_SEARCH_WORKERS", "VOIDACCESS_SCRAPE_WORKERS", "VOIDACCESS_EXTRACT_CONCURRENCY",
    "VOIDACCESS_SEARCH_DEADLINE", "VOIDACCESS_CONCURRENT_COLLECT", "VOIDACCESS_LLM_CHUNK_TIMEOUT",
    "VOIDACCESS_ENRICHMENT_TIMEOUT", "VOIDACCESS_ENRICHMENT_SOURCES", "VOIDACCESS_DISABLED_SOURCES",
    "VOIDACCESS_RSS_SNIPPET_ONLY",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)


def test_base_policy_is_assigned_not_defaulted(monkeypatch):
    monkeypatch.setenv("VOIDACCESS_SAFETY_BYPASS_PROMPT", "on")
    monkeypatch.setenv("VOIDACCESS_PRIVATE_MODE", "0")
    monkeypatch.setenv("MEILI_HOST", "http://meili:7700")
    monkeypatch.setenv("PLAYWRIGHT_ENABLED", "true")
    policy.apply_cloud_policy_base()
    assert os.environ["VOIDACCESS_SAFETY_BYPASS_PROMPT"] == "off"
    assert os.environ["VOIDACCESS_PRIVATE_MODE"] == "1" and os.environ["VA_CLOUD_POLICY"] == "1"
    assert "MEILI_HOST" not in os.environ and os.environ["PLAYWRIGHT_ENABLED"] == "false"


def test_depth_presets_and_cloud_profile():
    assert policy.apply_depth_preset("quick") == "shallow"
    assert os.environ["MAX_LLM_PAGES_PER_INV"] == "3" and os.environ["ENABLE_RELATIONSHIP_EXTRACTION"] == "false"
    assert policy.apply_depth_preset("standard") == "normal" and policy.apply_depth_preset("deep") == "deep"
    env = policy.apply_cloud_profile()
    assert os.environ["VOIDACCESS_LLM_CHUNK_TIMEOUT"] == "60" and os.environ["VOIDACCESS_SEARCH_WORKERS"] == "16"
    assert os.environ["VOIDACCESS_ENRICHMENT_SOURCES"] == "rdap,crtsh,wayback,cisa_kev,nvd,mitre_attack"
    assert "VOIDACCESS_PACE" not in env and "VOIDACCESS_PACE" not in os.environ
    with pytest.raises(policy.PolicyError):
        policy.apply_depth_preset("enormous")


def test_verify_policy_passes_when_in_effect_and_fails_closed_otherwise(monkeypatch):
    pytest.importorskip("sources.enrichment_allowlist", reason="engine tree not on PYTHONPATH")
    policy.apply_cloud_policy_base()
    policy.apply_depth_preset("standard")
    policy.apply_cloud_profile()
    policy.verify_policy()
    for name, value in (("VOIDACCESS_SAFETY_BYPASS_PROMPT", "on"), ("VOIDACCESS_PRIVATE_MODE", "0"), ("MEILI_HOST", "x")):
        monkeypatch.setenv(name, value)
        with pytest.raises(policy.PolicyError):
            policy.verify_policy()
        policy.apply_cloud_policy_base()
    monkeypatch.setenv("VOIDACCESS_ENRICHMENT_SOURCES", "not_a_source")
    with pytest.raises(Exception):
        policy.verify_policy()


def test_policy_requires_the_full_cloud_deny_list(monkeypatch):
    pytest.importorskip("sources.enrichment_allowlist", reason="engine tree not on PYTHONPATH")
    policy.apply_cloud_policy_base()
    policy.apply_cloud_profile()
    policy.verify_policy()
    monkeypatch.setenv("VOIDACCESS_DISABLED_SOURCES", "openphish")  # incomplete: other cloud-disabled sources missing
    with pytest.raises(policy.PolicyError):
        policy.verify_policy()
    monkeypatch.delenv("VOIDACCESS_DISABLED_SOURCES")
    with pytest.raises(policy.PolicyError):
        policy.verify_policy()


def test_a_source_the_engine_adds_to_its_cloud_deny_list_stops_the_runner(monkeypatch):
    """G2: the engine's CLOUD_DISABLED_SOURCES is the floor. If a later engine names one more source, the runner's
    presets.yaml no longer covers it and the run must refuse to start rather than collect from it."""
    sc = pytest.importorskip("sources.source_control", reason="engine tree not on PYTHONPATH")
    policy.apply_cloud_policy_base()
    policy.apply_cloud_profile()
    policy.verify_policy()
    monkeypatch.setattr(sc, "CLOUD_DISABLED_SOURCES", sc.CLOUD_DISABLED_SOURCES + ",github")
    with pytest.raises(policy.PolicyError, match="github"):
        policy.verify_policy()


def test_policy_requires_rss_snippet_only(monkeypatch):
    pytest.importorskip("sources.enrichment_allowlist", reason="engine tree not on PYTHONPATH")
    policy.apply_cloud_policy_base()
    policy.apply_cloud_profile()
    policy.verify_policy()
    monkeypatch.setenv("VOIDACCESS_RSS_SNIPPET_ONLY", "0")
    with pytest.raises(policy.PolicyError):
        policy.verify_policy()
