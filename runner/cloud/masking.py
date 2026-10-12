"""Masking rules: a port of packages/engine-client/src/mask.ts (cross-checked by tests against vectors
produced by that TypeScript module).

  - secrets, tokens, keys:  value `len:N sha256:<8-hex prefix>`, display `len:N`
  - emails / XMPP:          `j***@acme.com`
  - phones:                 `+***42`
  - personal names:         `J*** D***`
Nothing of a secret survives; the 8-hex prefix is the contract's G4 fingerprint.
"""

from __future__ import annotations

import hashlib
import re

from .taxonomy import TYPE_CATEGORY, is_secret_type


def mask_credential(value: str) -> str:
    return f"len:{len(value)}"


def secret_value_token(value: str) -> str:
    """Contract G4 `value` form for a secret: `len:N sha256:<8-hex prefix>`."""
    prefix = hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]
    return f"{mask_credential(value)} sha256:{prefix}"


def mask_partial(value: str) -> str:
    n = len(value)
    if n == 0:
        return ""
    if n <= 4:
        return "*" * n
    keep = 1 if n <= 8 else 2 if n <= 16 else 3
    hidden = min(n - 2 * keep, 8)
    return value[:keep] + "*" * hidden + value[n - keep :]


def mask_email(value: str) -> str:
    at = value.rfind("@")
    if at < 1 or at == len(value) - 1:
        return mask_partial(value)
    return f"{value[0]}***@{value[at + 1:]}"


def mask_phone(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if len(digits) < 7:
        return mask_partial(value)
    return f"{'+' if value.strip().startswith('+') else ''}***{digits[-2:]}"


def mask_entity_value(entity_type: str, value: str) -> str:
    """Display value: pre-masked when sensitive, unchanged for public indicator types."""
    if entity_type in TYPE_CATEGORY and is_secret_type(entity_type):
        return mask_credential(value)
    if entity_type in ("EMAIL_ADDRESS", "XMPP_JID"):
        return mask_email(value)
    if entity_type == "PHONE_NUMBER":
        return mask_phone(value)
    if entity_type == "PERSON_NAME":
        return " ".join(f"{w[0] if w else ''}***" for w in re.split(r"\s+", value))
    return value


def fingerprint_prefix(entity_type: str, value: str) -> str:
    """8 hex characters identifying a sensitive value for de-duplication without revealing it."""
    return hashlib.sha256(f"{entity_type}\u0000{value.strip().lower()}".encode("utf-8")).hexdigest()[:8]
