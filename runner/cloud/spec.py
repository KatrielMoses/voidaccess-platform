"""Fetch the single-use RunSpec and validate it against RunSpec.json.

The query exists only in this object. It is registered with the log scrubber the moment it is read and is
never printed.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from jsonschema import Draft202012Validator

from . import constants as C
from .identity import TokenSource, audience_for

SCHEMA_DIR = Path(__file__).resolve().parent / "schemas"
SPEC_FETCH_ATTEMPTS = 3
SPEC_HTTP_TIMEOUT_S = 15.0
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


class SpecError(RuntimeError):
    """The spec could not be fetched or is not acceptable. Messages never include the spec body."""


def load_schema(name: str) -> dict[str, Any]:
    return json.loads((SCHEMA_DIR / f"{name}.json").read_text(encoding="utf-8"))


_validators: dict[str, Draft202012Validator] = {}


def validator(name: str) -> Draft202012Validator:
    if name not in _validators:
        _validators[name] = Draft202012Validator(load_schema(name))
    return _validators[name]


def schema_errors(name: str, doc: Any, limit: int = 5) -> list[str]:
    """Short human-readable problems (path and message), never the offending values."""
    out: list[str] = []
    for err in sorted(validator(name).iter_errors(doc), key=lambda e: list(e.absolute_path)):
        path = "/".join(str(p) for p in err.absolute_path) or "(root)"
        out.append(f"{path}: {err.validator}")
        if len(out) >= limit:
            break
    return out


def _check_url(url: str, what: str) -> None:
    parts = urlsplit(url)
    if parts.scheme == "https":
        return
    if parts.scheme == "http" and (parts.hostname or "") in LOCAL_HOSTS:
        return  # local development receiver
    if what.startswith("artifact") and parts.scheme == "gs":
        return
    raise SpecError(f"{what} must be https (or gs:// for artifacts)")


def _artifact_urls(spec: dict[str, Any]) -> list[tuple[str, str]]:
    urls = spec["artifact_put_urls"]
    out = [("artifact bundle", urls["bundle"])]
    out += [(f"artifact {k}", v) for k, v in urls.get("exports", {}).items()]
    if urls.get("pages"):
        out.append(("artifact pages", urls["pages"]))
    return out


def validate_spec(spec: Any, expected_run_id: str | None = None) -> dict[str, Any]:
    problems = schema_errors("RunSpec", spec)
    if problems:
        raise SpecError("RunSpec failed validation: " + "; ".join(problems))
    run_id = spec["run_id"]
    if expected_run_id and run_id != expected_run_id:
        raise SpecError("RunSpec run_id does not match RUN_ID")
    _check_url(spec["callback_url"], "callback_url")
    for what, url in _artifact_urls(spec):
        _check_url(url, what)
        if url.startswith("gs://"):
            parts = urlsplit(url)
            if parts.netloc != C.ALLOWED_GCS_BUCKET or not parts.path.lstrip("/").startswith(f"runs/{run_id}/"):
                raise SpecError(f"{what} points outside gs://{C.ALLOWED_GCS_BUCKET}/runs/<run_id>/")
    try:
        datetime.fromisoformat(spec["deadline_at"].replace("Z", "+00:00"))
    except ValueError:
        raise SpecError("deadline_at is not an ISO timestamp") from None
    return spec


def fetch_spec(
    spec_url: str,
    tokens: TokenSource,
    expected_run_id: str | None = None,
    client: httpx.Client | None = None,
    sleep=time.sleep,
) -> dict[str, Any]:
    """GET the spec once (retried only when no response arrived or the app answered 5xx)."""
    _check_url(spec_url, "spec url")
    own = client is None
    client = client or httpx.Client(timeout=SPEC_HTTP_TIMEOUT_S)
    try:
        last = "no attempt"
        for attempt in range(1, SPEC_FETCH_ATTEMPTS + 1):
            headers = {"Accept": "application/json"}
            token = tokens.id_token(audience_for(spec_url))
            if token:
                headers["Authorization"] = f"Bearer {token}"
            try:
                resp = client.get(spec_url, headers=headers)
            except httpx.HTTPError as exc:
                last = type(exc).__name__
            else:
                if resp.status_code == 200:
                    try:
                        body = resp.json()
                    except ValueError:
                        raise SpecError("spec response is not JSON") from None
                    return validate_spec(body, expected_run_id)
                if resp.status_code < 500:
                    raise SpecError(f"spec fetch refused ({resp.status_code})")
                last = str(resp.status_code)
            if attempt < SPEC_FETCH_ATTEMPTS:
                sleep(1.0 * attempt)
        raise SpecError(f"spec fetch failed ({last})")
    finally:
        if own:
            client.close()


def parse_deadline(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
