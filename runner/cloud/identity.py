"""Google identity tokens and access tokens from the metadata server (plain HTTP, no extra dependency).

The app is a private Cloud Run service, so every call the runner makes to it (the spec fetch and every
callback) carries an identity token for the app's audience. Uploads to the runs bucket use an access
token of the runner's own service account.
"""

from __future__ import annotations

import os
import threading
import time
from urllib.parse import quote, urlsplit

import httpx

METADATA_BASE = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default"
METADATA_HEADERS = {"Metadata-Flavor": "Google"}
METADATA_TIMEOUT_S = 5.0
# Identity tokens live an hour; refresh well before that.
TOKEN_REFRESH_AFTER_S = 45 * 60
ACCESS_TOKEN_SKEW_S = 120

# Local development and tests: use a fixed token / no authentication instead of the metadata server.
ENV_FIXED_ID_TOKEN = "VA_ID_TOKEN"
ENV_NO_AUTH = "VA_NO_AUTH"


class IdentityError(RuntimeError):
    pass


def audience_for(url: str) -> str:
    """A Cloud Run service accepts an identity token whose audience is its URL (scheme + host)."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


class TokenSource:
    """Thread-safe cache of identity tokens (per audience) and the access token."""

    def __init__(self, client: httpx.Client | None = None, clock=time.monotonic):
        self._client = client or httpx.Client(timeout=METADATA_TIMEOUT_S)
        self._clock = clock
        self._lock = threading.Lock()
        self._id: dict[str, tuple[str, float]] = {}
        self._access: tuple[str, float] | None = None

    def _get(self, path: str) -> httpx.Response:
        try:
            resp = self._client.get(f"{METADATA_BASE}/{path}", headers=METADATA_HEADERS)
        except httpx.HTTPError as exc:
            raise IdentityError(f"metadata server unreachable ({type(exc).__name__})") from None
        if resp.status_code != 200:
            raise IdentityError(f"metadata server returned {resp.status_code}")
        return resp

    def id_token(self, audience: str, *, force: bool = False) -> str | None:
        """An identity token for `audience`, or None when running without authentication (dev)."""
        fixed = os.environ.get(ENV_FIXED_ID_TOKEN, "").strip()
        if fixed:
            return fixed
        if os.environ.get(ENV_NO_AUTH) == "1":
            return None
        with self._lock:
            cached = self._id.get(audience)
            if cached and not force and self._clock() < cached[1]:
                return cached[0]
            token = self._get(f"identity?audience={quote(audience, safe='')}&format=full").text.strip()
            self._id[audience] = (token, self._clock() + TOKEN_REFRESH_AFTER_S)
            return token

    def access_token(self) -> str:
        with self._lock:
            if self._access and self._clock() < self._access[1]:
                return self._access[0]
            data = self._get("token").json()
            token = str(data["access_token"])
            self._access = (token, self._clock() + max(30, int(data.get("expires_in", 300)) - ACCESS_TOKEN_SKEW_S))
            return token
