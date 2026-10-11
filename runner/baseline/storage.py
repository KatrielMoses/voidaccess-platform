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


def upload_json(blob_path: str, payload: Any) -> str:
    bucket = storage.Client().bucket(GCS_BUCKET)
    bucket.blob(blob_path).upload_from_string(
        json.dumps(payload, indent=2, default=str), content_type="application/json"
    )
    return f"gs://{GCS_BUCKET}/{blob_path}"


def download_json(blob_path: str) -> Any:
    bucket = storage.Client().bucket(GCS_BUCKET)
    return json.loads(bucket.blob(blob_path).download_as_text(encoding="utf-8"))


def upload_result_at(run_id: str, payload: dict[str, Any]) -> str:
    return upload_json(f"{GCS_BASE_PREFIX}/{run_id}/result.json", payload)
