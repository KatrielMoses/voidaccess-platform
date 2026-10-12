"""Export artifacts (STIX, MISP, Sigma, YARA, Snort, Suricata) from the engine's own exporters.

The exporters read the run's local database. Before they run, the sensitive rows of that database are
rewritten to their masked forms, so a raw credential, email, phone or name cannot reach an export; the
finished text is scrubbed once more with the raw values found in this run. A format that fails is skipped and
the reason (the exception type, never its message) goes to `metrics.export_errors`.
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from typing import Callable

from .bundle import RawSecrets
from .masking import mask_entity_value, secret_value_token
from .taxonomy import is_secret_type, is_sensitive_type, normalize_type

EXPORT_FORMATS = ("stix", "misp", "sigma", "yara", "snort", "suricata")
EXPORT_CONTENT_TYPE = {
    "stix": "application/json",
    "misp": "application/json",
    "sigma": "application/yaml",
    "yara": "text/plain",
    "snort": "text/plain",
    "suricata": "text/plain",
}
EXPORT_TLP = "TLP:AMBER"  # dark-web derived intelligence about a private investigation


def redact_local_db(db_path: Path, raw: RawSecrets) -> int:
    """Rewrite sensitive entity rows (and any free text that quotes a raw value) in the run's own database.
    Returns the number of rows changed. The database is ephemeral (this container's disk only)."""
    changed = 0
    conn = sqlite3.connect(str(db_path), timeout=30)
    try:
        rows = conn.execute(
            "SELECT id, entity_type, value, canonical_value, context_snippet, historical_context, "
            "corroborating_sources FROM entities"
        ).fetchall()
        for rid, etype_raw, value, canonical, context, historical, corroborating in rows:
            etype = normalize_type(etype_raw)
            new_value, new_canonical = value, canonical
            if etype and is_sensitive_type(etype):
                if is_secret_type(etype):
                    new_value = secret_value_token(value or "")
                    new_canonical = secret_value_token(canonical or value or "") if canonical else canonical
                else:
                    new_value = mask_entity_value(etype, value or "")
                    new_canonical = mask_entity_value(etype, canonical or "") if canonical else canonical
                new_context = None
            else:
                new_context = raw.scrub(context) if context else context
            new_historical = raw.scrub(historical) if historical else historical
            new_corr = raw.scrub(corroborating) if corroborating else corroborating
            if (new_value, new_canonical, new_context, new_historical, new_corr) != (
                value, canonical, context, historical, corroborating,
            ):  # fmt: skip
                conn.execute(
                    "UPDATE entities SET value=?, canonical_value=?, context_snippet=?, historical_context=?, "
                    "corroborating_sources=? WHERE id=?",
                    (new_value, new_canonical, new_context, new_historical, new_corr, rid),
                )
                changed += 1
        conn.commit()
    finally:
        conn.close()
    return changed


def _generators(investigation_id: str, run_id: str, query: str) -> dict[str, Callable[[], str]]:
    inv_uuid = uuid.UUID(investigation_id)
    meta = {"id": investigation_id, "run_id": run_id, "query": query, "summary": "", "created_at": None}

    def stix() -> str:
        from export import bundle_to_json, investigation_to_stix_bundle

        return bundle_to_json(investigation_to_stix_bundle(inv_uuid))

    def misp() -> str:
        from export import investigation_to_misp_event, misp_event_to_json

        return misp_event_to_json(investigation_to_misp_event(inv_uuid))

    def entities() -> list:
        from export.stix import _load_entities_for_investigation

        return _load_entities_for_investigation(str(inv_uuid))

    def sigma() -> str:
        from export import render_sigma_rules
        from voidaccess_cli.adapters import sqlite as sqlite_adapter

        return render_sigma_rules(sqlite_adapter.get_entities(investigation_id))

    def yara() -> str:
        from export.yara_export import generate_yara_rules

        return generate_yara_rules(entities(), meta, tlp=EXPORT_TLP)

    def snort_like(fmt: str) -> Callable[[], str]:
        def gen() -> str:
            from export.snort_export import generate_snort_rules

            return generate_snort_rules(entities(), meta, format=fmt, tlp=EXPORT_TLP)

        return gen

    return {
        "stix": stix,
        "misp": misp,
        "sigma": sigma,
        "yara": yara,
        "snort": snort_like("snort"),
        "suricata": snort_like("suricata"),
    }


def build_exports(
    investigation_id: str,
    run_id: str,
    query: str,
    raw: RawSecrets,
    wanted: tuple[str, ...] = EXPORT_FORMATS,
) -> tuple[dict[str, bytes], dict[str, str]]:
    """Returns ({format: bytes}, {format: reason it was skipped})."""
    out: dict[str, bytes] = {}
    errors: dict[str, str] = {}
    gens = _generators(investigation_id, run_id, query)
    for fmt in wanted:
        try:
            text = gens[fmt]()
            if not isinstance(text, str):
                raise TypeError("exporter returned a non-string")
            out[fmt] = raw.replace_pairs(text).encode("utf-8")
        except Exception as exc:  # one broken exporter must not cost the run
            errors[fmt] = type(exc).__name__
    return out, errors

