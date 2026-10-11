"""Upload baseline artifacts to GCS."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from google.cloud import storage

from baseline.constants import GCS_BASE_PREFIX, GCS_BUCKET


def upload_result(run_id: str, payload: dict[str, Any]) -> str:
    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob_path = f"{GCS_BASE_PREFIX}/{run_id}/result.json"
    blob = bucket.blob(blob_path)
    blob.upload_from_string(
        json.dumps(payload, indent=2, default=str),
        content_type="application/json",
    )
    return f"gs://{GCS_BUCKET}/{blob_path}"


def download_result(run_id: str) -> dict[str, Any] | None:
    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(f"{GCS_BASE_PREFIX}/{run_id}/result.json")
    if not blob.exists():
        return None
    return json.loads(blob.download_as_text(encoding="utf-8"))
