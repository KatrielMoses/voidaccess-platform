"""Contract v2 against the real engine: every trace event the 2.1.0 engine's own hooks emit must pass `sanitize_trace`.

Needs the engine on PYTHONPATH (its `progress` package). The events come from the engine's ProgressEmitter and the
hooks in `progress.trace` that the pipeline calls, fed with the shapes a real run produces: masked onion hosts,
defanged clearnet hosts, named search engines and sources, the `error` page outcome, `partial` / `timed_out` source
statuses and masked entities. Nothing here is copied from a real run.
"""

import pytest

from cloud.trace import TRACE_KINDS, sanitize_trace

pytest.importorskip("progress.trace", reason="engine tree not on PYTHONPATH")

ONION = "http://" + "a" * 52 + "fcid.onion/forum/thread?id=1"
ONION_2 = "http://" + "b" * 52 + "xyz7.onion/"
CLEAR = "https://leaks.example.com/path?q=secret"


def _engine_trace_events() -> list[dict]:
    from progress import CallbackSink, ProgressEmitter, Stage
    from progress import trace as tr

    seen: list[dict] = []
    em = ProgressEmitter(
        sinks=[CallbackSink(lambda e: seen.append(e.to_dict()))],
        run_id="r1",
        trace=True,
        trace_caps={"search.request": 2},
    )
    tr.bind(em)
    try:
        em.stage_start(Stage.REFINE)
        tr.query_refined("refine", 0, "lockbit ransomware affiliate panel")
        em.stage_end(Stage.REFINE)
        for engine in ("Ahmia (Clearnet Proxy)", "The Deep Searches", "Torch"):  # the third is over the cap
            tr.search_request(engine, 0)
        tr.search_result("Ahmia (Clearnet Proxy)", "ok", 12, ms=840, query_index=0)
        tr.search_result("The Deep Searches", "timeout", 0, ms=25000, query_index=0)
        tr.url_found("collect", ONION, engine="The Deep Searches", title="hitman services")  # masked name
        tr.url_found("collect", ONION_2, engine="Ahmia (Clearnet Proxy)")
        tr.url_found("collect", CLEAR, depth=1)
        tr.url_found("collect", "not a url at all")
        tr.url_kept("filter", ONION, score=0.91)
        tr.url_dropped("filter", ONION_2, "duplicate")
        tr.note_fetch(ONION, http_status=200, nbytes=5120, ms=3100)
        tr.page_fetched(ONION, "ok")
        tr.page_fetched(CLEAR, "error", ms=40000)  # a failed fetch (2.1.0 no longer stores it as a page)
        tr.page_entities(ONION, [
            {"entity_type": "RANSOMWARE_GROUP", "value": "LockBit", "confidence": 0.93},
            {"entity_type": "EMAIL_ADDRESS", "value": "affiliate@example.org", "confidence": 0.8},
            {"entity_type": "BITCOIN_ADDRESS", "value": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"},
            {"entity_type": "DOMAIN", "value": "panel.example.net"},
            {"entity_type": "API_KEY", "value": "ghp_" + "x" * 36},
        ])
        for source, status, hits in (
            ("nvd", "ok", 4), ("rdap", "partial", 1), ("crtsh", "timed_out", None),
            ("shodan", "skipped_by_allowlist", None), ("openphish", "disabled", None), ("wayback", "error", 0),
        ):
            tr.enrich_source(source, status, hits)
        tr.graph_progress(42, 57, communities=3)
        tr.summary_status("fallback", attempt=2)
        em.completed({})
    finally:
        tr.bind(None)
        em.close()
    return [e for e in seen if e.get("type") == "trace"]


def test_every_trace_the_2_1_0_engine_emits_passes_the_runner_sanitizer():
    events = _engine_trace_events()
    kinds = {e["kind"] for e in events}
    # every contract kind is exercised, including the cap overflow report
    assert kinds == set(TRACE_KINDS), sorted(set(TRACE_KINDS) - kinds)
    for e in events:
        assert e["schema"] == 2
        out = sanitize_trace(e)
        assert out is not None, e
        assert out["data"] == e["data"], e  # nothing the engine sends is altered or stripped


def test_the_engine_samples_carry_the_2_1_0_shapes():
    events = _engine_trace_events()
    hosts = [e["data"]["host"] for e in events if e["kind"] == "url.found"]
    assert "********…fcid[.]onion" in hosts and "bbbbbbbb…xyz7[.]onion" in hosts
    assert "leaks[.]example[.]com" in hosts
    outcomes = {e["data"]["outcome"] for e in events if e["kind"] == "page.fetched"}
    assert outcomes == {"ok", "error"}
    status = {e["data"]["source"]: e["data"]["status"] for e in events if e["kind"] == "enrich.source"}
    assert status == {
        "nvd": "ok", "rdap": "error", "crtsh": "timeout", "shodan": "disabled", "openphish": "disabled", "wayback": "error",
    }
    shown = " ".join(str(e["data"]) for e in events)
    for secret in ("affiliate@example.org", "/forum/thread", "q=secret", "x" * 36, "hitman"):
        assert secret not in shown, secret
