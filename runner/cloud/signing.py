"""Callback signing, per ENGINE-CONTRACT section 2 and packages/engine-client/src/hmac.ts.

X-VA-Signature = "sha256=" + hex(HMAC-SHA256(callback_secret, "<X-VA-Timestamp>.<raw body>")).
"""

from __future__ import annotations

import hashlib
import hmac
import time

HEADER_RUN = "X-VA-Run"
HEADER_SEQ = "X-VA-Seq"
HEADER_SIGNATURE = "X-VA-Signature"
HEADER_TIMESTAMP = "X-VA-Timestamp"


def compute_signature(secret: str, timestamp: int | str, raw_body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), digestmod=hashlib.sha256)
    mac.update(f"{timestamp}.".encode("utf-8"))
    mac.update(raw_body)
    return "sha256=" + mac.hexdigest()


def sign_callback(
    secret: str, run_id: str, seq: int, raw_body: bytes, timestamp: int | None = None
) -> dict[str, str]:
    ts = int(time.time()) if timestamp is None else timestamp
    return {
        HEADER_RUN: run_id,
        HEADER_SEQ: str(seq),
        HEADER_TIMESTAMP: str(ts),
        HEADER_SIGNATURE: compute_signature(secret, ts, raw_body),
    }
