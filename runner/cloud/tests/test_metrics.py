import json
from pathlib import Path

import pytest

from cloud.bundle import summary_points
from cloud.metrics import enrichment_calls, lower_only

ALLOW = "rdap,crtsh,wayback,cisa_kev,nvd,mitre_attack"


def test_enrichment_calls_counts_only_allowlisted_sources_that_ran():
    used = {
        "nvd": {"status": "ok", "count": 0},
        "sslbl": {"status": "ok", "count": 0},  # allowlisted off: reports ok with no call
        "rss": {"status": "ok", "count": 20},  # search stage
        "rdap": {"status": "ran"},
        "crtsh": {"status": "skipped"},
        "wayback": "weird",
    }
    assert enrichment_calls(used, ALLOW) == {"nvd": 1, "rdap": 1}
    assert enrichment_calls(None, ALLOW) == {} and enrichment_calls({"rss": {"status": "ok"}}, "") == {"rss": 1}


def test_overrides_can_only_tighten_a_limit():
    assert lower_only(70_000, "3000") == 3000
    assert lower_only(70_000, "900000") == 70_000
    assert lower_only(70_000, "0") == 70_000 and lower_only(70_000, "-5") == 70_000
    assert lower_only(70_000, "abc") == 70_000 and lower_only(70_000, None) == 70_000 and lower_only(480, "60") == 60


REAL = """### Intelligence Summary

**Threat Activity Found:**
The query "lazarus crypto theft" revealed indirect connections to Lazarus Group activity. Accounts are sold on markets.

**Key Actors, Tools, or Infrastructure Identified:**
The primary actor referenced is the Lazarus Group, a North Korean state-sponsored threat group. Other text follows.

**Operational Significance for Security Teams:**
Security teams should monitor for pre-verified cryptocurrency accounts. More text.

### Next Steps
- Search for related markets
"""


def test_findings_and_risks_from_the_engines_prose_summary():
    findings, risks = summary_points(REAL)
    assert findings == [
        'The query "lazarus crypto theft" revealed indirect connections to Lazarus Group activity.',
        "The primary actor referenced is the Lazarus Group, a North Korean state-sponsored threat group.",
    ]
    assert risks == ["Security teams should monitor for pre-verified cryptocurrency accounts."]
    assert not any("Search for related" in x for x in findings + risks)


def test_fallback_and_empty_summaries_give_no_points():
    assert summary_points("") == ([], [])
    assert summary_points("Automated summary for 'x' (the AI summary was unavailable...)\n\n- Malware Family: LockBit") == ([], [])


def test_the_committed_vectors_file_is_valid_json():
    assert json.loads((Path(__file__).parent / "vectors" / "engine-client.json").read_text())


def test_an_engine_summary_failure_string_becomes_the_engines_fallback_summary():
    pytest.importorskip("hygiene", reason="engine tree not on PYTHONPATH")
    from cloud.bundle import RawSecrets, build_summary

    cli = {
        "query": "akira",
        "refined_query": "akira ransomware",
        "summary": "Summary unavailable — LLM error: LLM token budget spent",
        "summary_kind": "llm",
        "entities": [
            {"entity_type": "RANSOMWARE_GROUP", "value": "Akira", "confidence": 0.9},
            {"entity_type": "EMAIL_ADDRESS", "value": "boss@victim.example", "confidence": 0.9},
        ],
    }
    out = build_summary(cli, 2, RawSecrets(), ["https://a.example/x", "https://b.example/y"])
    assert out["summary_kind"] == "fallback" and out["confidence"] == "low"
    assert out["markdown"].startswith("Automated summary for 'akira ransomware'")
    assert "Akira" in out["markdown"] and "boss@victim" not in out["markdown"]  # sensitive types are never echoed
    assert "https://a.example/x" in out["markdown"]
    assert out["risk_notes"] and "Summary unavailable" not in out["markdown"]


def test_a_normal_llm_summary_is_untouched():
    pytest.importorskip("hygiene", reason="engine tree not on PYTHONPATH")
    from cloud.bundle import RawSecrets, build_summary

    out = build_summary({"summary": "### Key Insights\n- A real finding.\n", "summary_kind": "llm"}, 20, RawSecrets())
    assert out["summary_kind"] == "llm" and out["key_findings"] == ["A real finding."] and out["confidence"] == "high"


def test_enrichment_calls_uses_real_request_counts_from_e1c_engines():
    used = {
        "nvd": {"status": "ok", "count": 0, "requests": 6},
        "rdap": {"status": "error", "count": 0, "requests": 2},
        "crtsh": {"status": "ok", "count": 3, "requests": 0},
        "openphish": {"status": "disabled", "count": 0, "requests": 0},
        "shodan": {"status": "ok", "count": 1, "requests": 4},  # not on the allowlist
    }
    assert enrichment_calls(used, "nvd,rdap,crtsh") == {"nvd": 6, "rdap": 2}


def test_enrichment_calls_counts_every_request_made_under_the_2_1_0_statuses():
    used = {
        "nvd": {"status": "ok", "count": 2, "requests": 3},
        "rdap": {"status": "partial", "count": 1, "requests": 4},
        "crtsh": {"status": "timed_out", "count": 0, "requests": 1},
        "wayback": {"status": "timed_out", "count": 0, "requests": 0},
        "cisa_kev": {"status": "skipped_by_allowlist", "count": 0, "requests": 0},
        "mitre_attack": {"status": "no_key", "count": 0, "requests": 0},
        "openphish": {"status": "disabled", "count": 0, "requests": 0},
    }
    assert enrichment_calls(used, ALLOW) == {"nvd": 3, "rdap": 4, "crtsh": 1}
