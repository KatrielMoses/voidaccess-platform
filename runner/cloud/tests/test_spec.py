import copy

import httpx
import pytest

from cloud.identity import TokenSource
from cloud.spec import SpecError, fetch_spec, validate_spec

RUN = "0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5d"


def spec(**over):
    s = {
        "run_id": RUN,
        "query": "lockbit leak site",
        "depth": "quick",
        "callback_url": f"https://app.example.test/api/engine/runs/{RUN}/events",
        "callback_secret": "0123456789abcdef",
        "artifact_put_urls": {
            "bundle": f"gs://voidaccess-cloud-runs/runs/{RUN}/bundle.json",
            "exports": {"stix": f"gs://voidaccess-cloud-runs/runs/{RUN}/stix.json"},
            "pages": f"gs://voidaccess-cloud-runs/runs/{RUN}/pages.jsonl.gz",
        },
        "deadline_at": "2026-10-12T10:00:00.000Z",
    }
    s.update(over)
    return s


def test_valid_spec_passes_and_http_urls_work_for_local_dev():
    assert validate_spec(spec(), RUN)["run_id"] == RUN
    local = spec(callback_url="http://localhost:3300/api/engine/runs/x/events")
    local["artifact_put_urls"] = {"bundle": "http://127.0.0.1:3300/api/engine/runs/x/artifacts/bundle?t=ab", "exports": {}}
    assert validate_spec(local)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s: s.pop("query"),
        lambda s: s.__setitem__("depth", "huge"),
        lambda s: s.__setitem__("callback_secret", "short"),
        lambda s: s.__setitem__("deadline_at", "tomorrow"),
        lambda s: s["artifact_put_urls"].pop("bundle"),
        lambda s: s["artifact_put_urls"]["exports"].__setitem__("exe", "https://x.test/a"),
        lambda s: s.__setitem__("extra", 1),
    ],
)
def test_schema_violations_are_rejected(mutate):
    s = copy.deepcopy(spec())
    mutate(s)
    with pytest.raises(SpecError):
        validate_spec(s)


@pytest.mark.parametrize(
    "bad",
    [
        {"callback_url": "http://evil.example.test/cb"},  # plain http only for localhost
        {"callback_url": "ftp://x.test/cb"},
    ],
)
def test_unsafe_urls_are_rejected(bad):
    with pytest.raises(SpecError):
        validate_spec(spec(**bad))


def test_gs_urls_must_stay_inside_the_runs_prefix_of_the_runs_bucket():
    for url in ("gs://other-bucket/runs/%s/bundle.json" % RUN, "gs://voidaccess-cloud-runs/runs/other-run/bundle.json", "gs://voidaccess-cloud-runs/baseline/x"):
        s = spec()
        s["artifact_put_urls"]["bundle"] = url
        with pytest.raises(SpecError):
            validate_spec(s, RUN)


def test_run_id_must_match_the_environment():
    with pytest.raises(SpecError):
        validate_spec(spec(), "some-other-run")


def tokens(monkeypatch):
    monkeypatch.setenv("VA_ID_TOKEN", "tok")
    return TokenSource()


def test_fetch_sends_an_identity_token_once_and_validates(monkeypatch):
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=spec())

    out = fetch_spec(f"https://app.example.test/api/engine/runs/{RUN}/spec?t=x", tokens(monkeypatch), RUN, httpx.Client(transport=httpx.MockTransport(handler)))
    assert out["query"] == "lockbit leak site" and len(seen) == 1
    assert seen[0].headers["authorization"] == "Bearer tok"


def test_fetch_retries_5xx_but_not_4xx_and_never_echoes_the_body(monkeypatch):
    calls = []

    def flaky(req):
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json=spec())

    c = httpx.Client(transport=httpx.MockTransport(flaky))
    assert fetch_spec("https://app.example.test/s", tokens(monkeypatch), RUN, c, sleep=lambda s: None)["run_id"] == RUN
    assert len(calls) == 3

    gone = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404, json={"query": "secret-query-text"})))
    with pytest.raises(SpecError) as e:
        fetch_spec("https://app.example.test/s", tokens(monkeypatch), RUN, gone, sleep=lambda s: None)
    assert "secret-query-text" not in str(e.value)


def test_invalid_spec_error_does_not_contain_the_query(monkeypatch):
    bad = spec(depth="huge")
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=bad)))
    with pytest.raises(SpecError) as e:
        fetch_spec("https://app.example.test/s", tokens(monkeypatch), RUN, c, sleep=lambda s: None)
    assert "lockbit" not in str(e.value) and "0123456789abcdef" not in str(e.value)
