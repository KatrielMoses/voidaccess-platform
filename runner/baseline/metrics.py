"""Read investigation metrics from SQLite (counts only — no page text)."""

from __future__ import annotations

import sqlite3
import uuid
from collections import Counter
from pathlib import Path
from typing import Any


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _id_variants(investigation_id: str) -> list[str]:
    inv = uuid.UUID(investigation_id)
    return list(dict.fromkeys([str(inv), inv.hex, investigation_id]))


def collect_sqlite_metrics(db_path: Path, investigation_id: str) -> dict[str, Any]:
    """One SQLite file per run, so page bytes are the whole pages table."""
    ids = _id_variants(investigation_id)
    placeholders = ",".join("?" for _ in ids)
    try:
        return _collect(db_path, ids, placeholders)
    except sqlite3.Error:
        return {}


def _collect(db_path: Path, ids: list[str], placeholders: str) -> dict[str, Any]:
    with _connect(db_path) as conn:
        pages = conn.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(byte_size), 0) AS bytes FROM pages"
        ).fetchone()

        entity_types = conn.execute(
            f"SELECT entity_type, COUNT(*) AS c FROM entities WHERE investigation_id IN ({placeholders}) GROUP BY entity_type",
            ids,
        ).fetchall()
        rel_types = conn.execute(
            f"SELECT relationship_type, COUNT(*) AS c FROM entity_relationships WHERE investigation_id IN ({placeholders}) GROUP BY relationship_type",
            ids,
        ).fetchall()
        actors = conn.execute(
            f"SELECT COUNT(*) FROM entities WHERE investigation_id IN ({placeholders}) AND entity_type = 'actor'",
            ids,
        ).fetchone()
        step_rows = conn.execute(
            "SELECT step_name, duration_ms, llm_calls, pages_fetched FROM investigation_step_metrics "
            f"WHERE investigation_id IN ({placeholders})",
            ids,
        ).fetchall()

    stage_ms = {row["step_name"]: float(row["duration_ms"]) for row in step_rows}
    llm_calls = sum(int(row["llm_calls"]) for row in step_rows)
    pages_fetched_metric = max((int(row["pages_fetched"]) for row in step_rows), default=0)

    return {
        "pages_count": int(pages["n"] or 0),
        "bytes_fetched": int(pages["bytes"] or 0),
        "pages_fetched_from_steps": pages_fetched_metric,
        "entities_by_type": {row["entity_type"]: int(row["c"]) for row in entity_types},
        "relationships_by_type": {row["relationship_type"]: int(row["c"]) for row in rel_types},
        "actors_count": int(actors[0] if actors else 0),
        "stage_ms": stage_ms,
        "llm_calls_from_steps": llm_calls,
        "typed_relationship_samples": _sample_typed_edges(db_path, ids),
    }


def _sample_typed_edges(db_path: Path, ids: list[str], limit: int = 5) -> list[dict[str, str]]:
    """Return edge type + entity types only (no values)."""
    cooccurrence = {"co_occurrence", "co-occurrence", "related"}
    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT er.relationship_type,
                   ea.entity_type AS src_type,
                   eb.entity_type AS tgt_type
            FROM entity_relationships er
            JOIN entities ea ON ea.id = er.entity_a_id
            JOIN entities eb ON eb.id = er.entity_b_id
            WHERE er.investigation_id IN (""" + ",".join("?" for _ in ids) + """)
            LIMIT 200
            """,
            ids,
        ).fetchall()
    samples: list[dict[str, str]] = []
    for row in rows:
        rtype = row["relationship_type"] or ""
        if rtype.lower() in cooccurrence:
            continue
        samples.append(
            {
                "relationship_type": rtype,
                "source_entity_type": row["src_type"],
                "target_entity_type": row["tgt_type"],
            }
        )
        if len(samples) >= limit:
            break
    return samples


def aggregate_entity_counts(entities: list[dict[str, Any]]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for ent in entities:
        et = ent.get("type") or ent.get("entity_type") or "unknown"
        counts[str(et)] += 1
    return counts


def aggregate_relationship_counts(relationships: list[dict[str, Any]]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for rel in relationships:
        rt = rel.get("type") or rel.get("relationship_type") or "unknown"
        counts[str(rt)] += 1
    return counts
