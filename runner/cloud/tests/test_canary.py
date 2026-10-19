"""The canary's engine classification from the engine's own warnings (cloud/canary.py)."""

from cloud.canary import _engine_counts


def test_engines_are_counted_once_by_outcome():
    started = {"A", "B", "C", "D", "E"}
    finished = {"A": True, "B": False, "C": False, "D": True}
    warnings = [
        "Engine B timed out",
        "Engine C failed: HTTP 502",
        "Engine D returned 0 results",  # an answer, not a failure
        "Scraping 3 onion URLs (via Tor) + 0 clearnet URLs (direct)",
    ]
    assert _engine_counts(started, finished, warnings) == {
        "engines_started": 5,
        "engines_ok": 2,
        "engines_timed_out": 1,
        "engines_error": 1,
        "engines_cut_by_deadline": 1,  # E started and never finished
    }
