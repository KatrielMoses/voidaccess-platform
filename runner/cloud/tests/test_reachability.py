"""R2b-5 rule details (cloud/reachability.py): which engine outcomes count and when the decision is final."""

from cloud.reachability import Reachability

ENGINES = [f"E{i}" for i in range(8)]


def tr(kind, **data):
    return {"type": "trace", "kind": kind, "data": data}


def test_an_engine_that_answers_on_any_refined_query_counts_as_answering():
    r = Reachability(ENGINES)
    r.observe(tr("search.result", engine="E0", status="timeout", query_index=0))
    r.observe(tr("search.result", engine="E0", status="ok", query_index=1, results=0))  # zero links is an answer
    assert r.summary()["onion_engines_answered"] == 1 and not r.engines_failed()


def test_asked_but_never_answered_counts_as_failed_and_disabled_alone_does_not_count():
    r = Reachability(ENGINES)
    for name in ENGINES[:4]:
        r.observe(tr("search.request", engine=name, query_index=0))  # cut by the deadline: no result at all
    for name in ENGINES[4:]:
        r.observe(tr("search.result", engine=name, status="disabled"))  # circuit breaker: never asked
    assert r.summary()["onion_engines_asked"] == 4 and r.engines_failed()
    assert r.check("collect")  # and no onion URL was found


def test_side_sources_and_other_events_are_ignored_and_no_traces_never_trip_the_rule():
    r = Reachability(ENGINES)
    r.observe(tr("search.result", engine="github", status="error"))
    r.observe({"type": "stage", "stage": "collect", "status": "end"})
    assert r.summary()["onion_engines_asked"] == 0
    assert not r.check("collect") and not r.check("fetch")  # an engine without trace events: judged as before


def test_the_ratio_is_inclusive_and_only_collect_and_fetch_decide():
    r = Reachability(ENGINES)
    for i, name in enumerate(ENGINES[:4]):
        r.observe(tr("search.result", engine=name, status="ok" if i == 0 else "timeout"))
    assert r.engines_failed()  # 3 of 4 = 0.75
    assert r.check("fetch") and not r.check("filter") and not r.check("extract")
    r.observe(tr("url.found", url_id="u1", host="abcdefgh…wxyz[.]onion"))
    assert not r.check("collect") and r.check("fetch")
    r.observe(tr("page.fetched", url_id="u1", outcome="empty"))
    assert r.check("fetch")  # fetched but no text is not a page with content
    r.observe(tr("page.fetched", url_id="u1", outcome="ok"))
    assert not r.check("fetch")


def test_a_clearnet_page_is_not_an_onion_page():
    r = Reachability(ENGINES)
    r.observe(tr("search.result", engine="E0", status="timeout"))
    r.observe(tr("url.found", url_id="c1", host="github[.]com"))
    r.observe(tr("page.fetched", url_id="c1", outcome="ok"))
    assert r.check("fetch")
