"""OpenRouter key usage (shared-key delta or per-run provisioning)."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from baseline.constants import (
    OPENROUTER_USAGE_SETTLE_MAX_WAIT_S,
    OPENROUTER_USAGE_SETTLE_POLL_INTERVAL_S,
)

STABLE_POLLS_REQUIRED = 2
OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"


@dataclass
class KeyUsage:
    usage_usd: float
    limit_remaining: float | None
    raw: dict[str, Any]


def fetch_key_usage(api_key: str) -> KeyUsage:
    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(OPENROUTER_KEY_URL, headers=headers)
        resp.raise_for_status()
        data = resp.json().get("data") or resp.json()
    usage = float(data.get("usage") or data.get("usage_daily") or 0.0)
    limit_remaining = data.get("limit_remaining")
    if limit_remaining is not None:
        limit_remaining = float(limit_remaining)
    return KeyUsage(usage_usd=usage, limit_remaining=limit_remaining, raw=data)


def wait_for_stable_usage(api_key: str, baseline: float) -> float:
    """Poll until usage is unchanged for STABLE_POLLS_REQUIRED polls in a row, or timeout."""
    deadline = time.monotonic() + OPENROUTER_USAGE_SETTLE_MAX_WAIT_S
    last = baseline
    stable = 0
    while time.monotonic() < deadline:
        time.sleep(OPENROUTER_USAGE_SETTLE_POLL_INTERVAL_S)
        current = fetch_key_usage(api_key).usage_usd
        stable = stable + 1 if abs(current - last) < 1e-9 else 0
        last = current
        if stable >= STABLE_POLLS_REQUIRED:
            break
    return max(0.0, last - baseline)


def provisioning_secret_available() -> bool:
    """True when openrouter-provisioning-key has an enabled Secret Manager version."""
    try:
        from google.cloud import secretmanager

        client = secretmanager.SecretManagerServiceClient()
        name = (
            f"projects/{os.environ.get('GCP_PROJECT', 'voidaccess-cloud')}/secrets/"
            "openrouter-provisioning-key/versions/latest"
        )
        client.access_secret_version(request={"name": name})
        return True
    except Exception:
        return False
