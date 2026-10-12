"""Artifact uploads. `artifact_put_urls` may be:

  - https:// (a presigned URL, or the app's dev mock route): HTTP PUT. The runner's identity token is added
    only when the URL is on the app's own host (a private Cloud Run service); a presigned storage URL
    never receives it.
  - gs://voidaccess-cloud-runs/runs/<run_id>/<name> (production): uploaded through the Cloud Storage JSON
    API with the runner's own service account.
"""

from __future__ import annotations

import time
from typing import Callable
from urllib.parse import quote, urlsplit

import httpx

from . import constants as C
from .identity import TokenSource, audience_for

GCS_UPLOAD_URL = "https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={name}"


class UploadError(RuntimeError):
    pass


class Uploader:
    def __init__(
        self,
        tokens: TokenSource,
        app_url: str,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._tokens = tokens
        self._app_audience = audience_for(app_url)
        self._client = client or httpx.Client(timeout=C.UPLOAD_HTTP_TIMEOUT_S)
        self._sleep = sleep

    def _request(self, url: str, data: bytes, content_type: str) -> httpx.Response:
        parts = urlsplit(url)
        headers = {"Content-Type": content_type}
        if parts.scheme == "gs":
            bucket, name = parts.netloc, parts.path.lstrip("/")
            if bucket != C.ALLOWED_GCS_BUCKET:
                raise UploadError("bucket not allowed")
            headers["Authorization"] = f"Bearer {self._tokens.access_token()}"
            return self._client.post(
                GCS_UPLOAD_URL.format(bucket=bucket, name=quote(name, safe="")), content=data, headers=headers
            )
        if audience_for(url) == self._app_audience:
            token = self._tokens.id_token(self._app_audience)
            if token:
                headers["Authorization"] = f"Bearer {token}"
        return self._client.put(url, content=data, headers=headers)

    def put(self, url: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        """Upload `data` to `url`; retried with backoff on a 5xx or a network error."""
        last = "no attempt"
        for attempt in range(1, C.UPLOAD_ATTEMPTS + 1):
            try:
                resp = self._request(url, data, content_type)
                if 200 <= resp.status_code < 300:
                    return
                last = f"status {resp.status_code}"
                if resp.status_code < 500 and resp.status_code not in (408, 429):
                    break
            except httpx.HTTPError as exc:
                last = type(exc).__name__
            if attempt < C.UPLOAD_ATTEMPTS:
                self._sleep(0.5 * 2 ** (attempt - 1))
        raise UploadError(f"upload failed ({last})")
