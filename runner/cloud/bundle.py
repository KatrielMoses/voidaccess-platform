"""Turns the engine's CLI JSON plus the run's local SQLite into a ResultBundle (schema_version 1).

Guarantee 5: no sensitive raw value leaves the container.
  - entities of secret types (API keys, tokens, passwords, seed phrases...) carry `value` =
    `len:N sha256:<8-hex>` and `display_value` = `len:N`;
  - emails, phones and personal names carry only the masked form (`j***@acme.com`) in both fields, plus an
    `fp:<8-hex>` tag so the same value can be recognised without being recoverable;
  - source excerpts are at most 500 characters and come from the engine's own `sanitizer.sanitize_page`
    (content-safety drop, credentials to presence-only, PII and names removed); a page the gate drops is
    not a source at all;
  - the summary text and actor aliases are scrubbed of every raw sensitive value, credential patterns and
    email/phone patterns before they are written.
The mapping rules are in the module docstrings below and in the R0 handoff.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from . import constants as C
from .masking import fingerprint_prefix, mask_entity_value, secret_value_token
from .taxonomy import ACTOR_TYPES, is_secret_type, is_sensitive_type, normalize_type

MEDIA_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tif", ".tiff",
    ".mp4", ".webm", ".mov", ".avi", ".mkv", ".mp3", ".wav", ".ogg", ".flac", ".pdf",
)  # fmt: skip
PASTE_HOSTS = ("pastebin.", "paste.ee", "dpaste.", "rentry.", "ghostbin.", "justpaste.", "paste.")
CODE_FORGE_HOSTS = ("github.com", "gitlab.com", "raw.githubusercontent.com", "gist.github.com")
# Source labels the engine puts on pages (investigate.py: page["source"]) that decide the bundle kind.
_LABEL_KIND = (
    ("tor_search", "onion_page"),
    ("onion", "onion_page"),
    ("telegram", "feed"),
    ("paste", "paste"),
    ("github", "code_forge"),
    ("gitlab", "code_forge"),
    ("rss", "feed"),
    ("feed", "feed"),
    ("enrichment", "enrichment"),
    ("shared_corpus", "feed"),
)
_ACTOR_ALIAS_SKIP_TYPES = frozenset({"email", "wallet", "pgp_fingerprint", "phone"})
_BULLET_RE = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s+(.*\S)\s*$")
_PLAIN_BULLET_RE = re.compile(r"^\s*[-*\u2022]\s+")
_MD_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")
_BOLD_HEADING_RE = re.compile(r"^\s*(?:[-*\u2022]\s+)?\*\*(.{2,90}?)\*\*:?\s*$|^\s*\*\*(.{2,90}?):\*\*\s*$")
_NUMBERED_HEADING_RE = re.compile(r"^\s*\d+[.)]\s+(.{2,90})$")
_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")
# Section titles of the engine's summary prompts (voidaccess/llm.py PRESET_PROMPTS output formats). A numbered line is
# a heading only when it starts with one of these; markdown (`###`) and bold-only lines are headings anyway.
_SECTION_TITLES = (
    "input query", "source link", "investigation artifact", "key insight", "key finding", "next step",
    "malware", "threat actor profile", "intelligence summary", "threat activity", "key actors",
    "operational significance", "risk", "caveat", "limitation",
)  # fmt: skip
# Titles whose content is not a finding (the query echoed back, the sources, what to do next).
_NOT_FINDINGS = ("input query", "source link", "next step", "intelligence summary")
_RISK_TITLES = ("operational significance", "risk", "caveat", "limitation", "recommendation")
_MIN_RAW_REPLACE_LEN = 4
# Entities whose value is several secrets joined together; each part is registered for scrubbing too.
COMPOUND_SECRET_TYPES = frozenset({"COMBO_LIST_ENTRY", "STEALER_LOG_ENTRY"})


def dash_uuid(value: Any) -> str:
    """Canonical dashed form of an id (the engine's SQLite stores hex, its CLI JSON stores dashes)."""
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return str(value)


def iso_utc(value: Any) -> str | None:
    """An ISO-8601 timestamp with an explicit offset (naive SQLite datetimes are UTC), or None."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip().replace(" ", "T").replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def clamp01(x: Any, default: float = 0.0) -> float:
    try:
        return max(0.0, min(1.0, float(x)))
    except (TypeError, ValueError):
        return default


def clean_url(url: str) -> str | None:
    """Text URLs only: http(s), no userinfo, no credential-looking parts, and not a media file."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    if parts.path.lower().endswith(MEDIA_EXTENSIONS):
        return None
    host = parts.hostname + (f":{parts.port}" if parts.port else "")
    from sanitizer.detectors import redact_credentials

    cleaned = urlunsplit((parts.scheme, host, parts.path, parts.query, ""))
    return redact_credentials(cleaned)


# Data under CC BY 4.0 must carry its credit wherever it is shown (docs/baseline/E0-LICENCE-TABLE.md row 16).
_CREDITS = (("ransomlook", "RansomLook (ransomlook.io, CC BY 4.0)"),)


def _source_name(url: str, label: str) -> str:
    name = urlsplit(url).hostname or label or "page"
    lab = (label or "").lower()
    for needle, credit in _CREDITS:
        if needle in lab:
            name = f"{credit} \u00b7 {name}"
    return name[:200]


def source_kind(url: str, label: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    lab = (label or "").lower()
    if host.endswith(".onion"):
        return "onion_page"
    for needle, kind in _LABEL_KIND:
        if needle in lab:
            return kind
    if any(host == h or host.endswith("." + h) for h in CODE_FORGE_HOSTS):
        return "code_forge"
    if any(h in host for h in PASTE_HOSTS):
        return "paste"
    return "feed"


@dataclass
class RawSecrets:
    """Raw sensitive values found in this run, each with its safe replacement. Lives in memory only: it is
    used to scrub free text and the export artifacts, and is never serialized."""

    pairs: dict[str, str] = field(default_factory=dict)

    def add(self, raw: str, replacement: str) -> None:
        raw = (raw or "").strip()
        if len(raw) >= _MIN_RAW_REPLACE_LEN and raw not in self.pairs:
            self.pairs[raw] = replacement

    def replace_pairs(self, text: str) -> str:
        """Replace every raw sensitive value found in this run by its masked form."""
        for raw in sorted(self.pairs, key=len, reverse=True):
            if raw in text:
                text = text.replace(raw, self.pairs[raw])
        return text

    def scrub(self, text: str) -> str:
        """Replace every raw sensitive value, then redact credential patterns and email/phone patterns."""
        if not text:
            return text
        text = self.replace_pairs(text)
        from hygiene import strip_pii
        from sanitizer.detectors import redact_credentials

        return strip_pii(redact_credentials(text))


@dataclass
class BundleInputs:
    run_id: str
    query: str
    depth: str
    started_at: str
    completed_at: str
    engine_version: str
    metrics: dict[str, Any]
    cli_payload: dict[str, Any]
    db_path: Path


@dataclass
class BuiltBundle:
    bundle: dict[str, Any]
    raw: RawSecrets
    sanitized_pages: dict[str, str]  # dashed page id -> sanitized text (reused by the archive)
    page_rows: dict[str, dict[str, Any]]  # dashed page id -> {url, fetched_at, content_hash}
    dropped_entities: dict[str, int]


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def load_pages(db_path: Path) -> list[dict[str, Any]]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, url, cleaned_text, scrape_timestamp, raw_content_hash, byte_size FROM pages"
        ).fetchall()
    return [dict(r) for r in rows]


def sanitize_pages(pages: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
    """Run each page through the engine's own sanitizer gate. Returns (sanitized text, page info) for the pages
    that survive; a page the gate drops (content-safety, or NER unavailable: it fails closed), or whose URL is
    not a text URL, is absent from both."""
    from sanitizer.gate import sanitize_page

    texts: dict[str, str] = {}
    info: dict[str, dict[str, Any]] = {}
    for p in pages:
        url = clean_url(p.get("url") or "")
        if url is None:
            continue
        raw_text = p.get("cleaned_text") or ""
        sanitized = sanitize_page(raw_text) if raw_text else None
        if sanitized is None:
            continue
        pid = dash_uuid(p["id"])
        texts[pid] = sanitized
        info[pid] = {
            "url": url,
            "fetched_at": iso_utc(p.get("scrape_timestamp")) or iso_utc(datetime.now(timezone.utc)),
            "content_hash": p.get("raw_content_hash") or hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
        }
    return texts, info


def _excerpt(text: str) -> str:
    return " ".join(text.split())[: C.EXCERPT_MAX_CHARS]


def _heading_title(line: str) -> str | None:
    """The lowercased title when `line` is a section heading of the summary, else None."""
    stripped = line.strip()
    if _PLAIN_BULLET_RE.match(stripped) and not _BOLD_HEADING_RE.match(stripped):
        return None
    for rx in (_MD_HEADING_RE, _BOLD_HEADING_RE):
        m = rx.match(line)
        if m:
            return next(g for g in m.groups() if g).strip(" *:#").lower()
    m = _NUMBERED_HEADING_RE.match(line)
    if m:
        title = m.group(1).strip(" *:#").lower()
        if len(title) < 90 and not title.endswith(".") and any(title.startswith(t) for t in _SECTION_TITLES):
            return title
    return None


def summary_sections(markdown: str) -> list[tuple[str, list[str]]]:
    """(lowercased title, body lines) for every heading of the summary, in order."""
    sections: list[tuple[str, list[str]]] = []
    for line in markdown.splitlines():
        if not line.strip():
            continue
        title = _heading_title(line)
        if title is not None:
            sections.append((title, []))
        elif sections:
            sections[-1][1].append(line)
    return sections


def _section_points(body: list[str]) -> list[str]:
    """The bullet items of a section, or (when it is prose) its first sentence."""
    items: list[str] = []
    for line in body:
        bullet = _BULLET_RE.match(line)
        if bullet:
            items.append(bullet.group(1).strip()[:500])
        elif items:
            items[-1] = (items[-1] + " " + line.strip())[:500]
    if items:
        return items
    text = " ".join(x.strip() for x in body).strip()
    return [_SENTENCE_END_RE.split(text, maxsplit=1)[0][:500]] if text else []


def summary_points(markdown: str) -> tuple[list[str], list[str]]:
    """(key_findings, risk_notes) from the engine's summary. Findings are the points of every section that is not the
    query echo, the source list or the next steps; risk notes are the points of the risk / operational-significance
    sections. Both are empty when the summary has no recognisable sections (the fallback summary)."""
    findings: list[str] = []
    risks: list[str] = []
    for title, body in summary_sections(markdown):
        points = _section_points(body)
        if title.startswith(_RISK_TITLES):
            risks += points
        elif not title.startswith(_NOT_FINDINGS):
            findings += points
    return findings[:10], risks[:10]


def summary_confidence(kind: str, source_count: int) -> str:
    if kind != "llm":
        return "low"
    if source_count >= 15:
        return "high"
    return "medium" if source_count >= 5 else "low"


# Engines before E1C (0dd59da) returned this text from `generate_summary` instead of raising, so their fallback never
# ran. E1C raises and falls back itself (summary_kind "fallback"); this check is kept only as a guard for older images.
ENGINE_SUMMARY_FAILURE_PREFIX = "Summary unavailable"


def _fallback_markdown(refined: str, cli: dict[str, Any], page_urls: list[str]) -> str:
    try:
        from voidaccess.summary_fallback import build_fallback_summary

        return build_fallback_summary(
            refined, cli.get("entities") or [], [{"url": u} for u in page_urls]
        )
    except Exception:
        return "The AI summary was unavailable for this run."


def build_summary(
    cli: dict[str, Any], source_count: int, raw: RawSecrets, page_urls: list[str] | None = None
) -> dict[str, Any]:
    kind = str(cli.get("summary_kind") or "none")
    markdown = str(cli.get("summary") or "")
    if markdown.lstrip().startswith(ENGINE_SUMMARY_FAILURE_PREFIX):
        kind = "fallback"
        markdown = _fallback_markdown(str(cli.get("refined_query") or cli.get("query") or ""), cli, page_urls or [])
    markdown = raw.scrub(markdown)
    found, risk = summary_points(markdown)
    findings = [raw.scrub(x) for x in found]
    risks = [raw.scrub(x) for x in risk]
    if kind != "llm":
        risks.append("The AI summary was unavailable for this run; this summary was built from extracted entities only.")
    return {
        "markdown": markdown,
        "key_findings": findings,
        "risk_notes": risks,
        "confidence": summary_confidence(kind, source_count),
        "source_count": source_count,
        "summary_kind": kind,
    }


def _entity_rows_from_db(db_path: Path) -> dict[str, dict[str, Any]]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, page_id, extraction_method, first_seen FROM entities"
        ).fetchall()
    return {dash_uuid(r["id"]): dict(r) for r in rows}


def _relationship_pages_from_db(db_path: Path) -> dict[str, str | None]:
    with _connect(db_path) as conn:
        rows = conn.execute("SELECT id, source_page_id FROM entity_relationships").fetchall()
    return {dash_uuid(r["id"]): (dash_uuid(r["source_page_id"]) if r["source_page_id"] else None) for r in rows}


def _actor_profiles_from_db(db_path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    try:
        with _connect(db_path) as conn:
            for r in conn.execute(
                "SELECT canonical_handle, first_seen_at, last_seen_at, id FROM actor_profiles"
            ).fetchall():
                aliases = conn.execute(
                    "SELECT alias_value, alias_type FROM actor_aliases WHERE actor_id = ?", (r["id"],)
                ).fetchall()
                out[str(r["canonical_handle"]).lower()] = {
                    "first_seen": iso_utc(r["first_seen_at"]),
                    "last_seen": iso_utc(r["last_seen_at"]),
                    "aliases": [
                        (a["alias_value"], (a["alias_type"] or "").lower()) for a in aliases
                    ],
                }
    except sqlite3.Error:
        return {}
    return out


# ---- relevance tiers (contract v0.4, engine 2.2 / 22R) --------------------------------------------------------------
TIERS = ("direct", "related", "background")
_TIER_RANK = {t: i for i, t in enumerate(TIERS)}
PAGE_KINDS = (
    "directory", "search_portal", "market_listing", "forum_thread", "leak_post", "paste", "news_article", "feed_item",
    "other",
)  # fmt: skip
REASON_MAX = 120
_REASON_OK = re.compile(r"[^\x00-\x1f<>]+")


def tier_of(value: Any) -> str | None:
    """The contract tier, or None (an engine before 2.2, or a value this runner does not know)."""
    return value if isinstance(value, str) and value in _TIER_RANK else None


def stronger_tier(a: str | None, b: str | None) -> str | None:
    if a is None:
        return b
    if b is None:
        return a
    return a if _TIER_RANK[a] <= _TIER_RANK[b] else b


def weaker_tier(a: str | None, b: str | None) -> str | None:
    if a is None or b is None:
        return None
    return a if _TIER_RANK[a] >= _TIER_RANK[b] else b


def reason_of(value: Any) -> str | None:
    """A bounded machine reason (`term_match:lockbit`, `near_direct_match`); anything else is left out."""
    if not isinstance(value, str):
        return None
    v = value.strip()[:REASON_MAX]
    return v if v and _REASON_OK.fullmatch(v) else None


def page_kind_of(value: Any) -> str | None:
    if value is None or value == "":
        return None
    return value if value in PAGE_KINDS else "other"


def _tier_fields(tier: str | None, reason: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if tier is not None:
        out["relevance"] = tier
        r = reason_of(reason)
        if r is not None:
            out["relevance_reason"] = r
    return out


def _count_tiers(items: list[dict[str, Any]]) -> dict[str, int]:
    c = Counter(x.get("relevance") for x in items)
    return {t: int(c.get(t, 0)) for t in TIERS}


def _int0(v: Any) -> int:
    try:
        return max(0, int(v))
    except (TypeError, ValueError):
        return 0


def build_relevance(cli: dict[str, Any], sources: list[dict[str, Any]], entities: list[dict[str, Any]],
                    relationships: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The bundle's run-level relevance summary, or None when the engine sent no tiers (before 2.2).
    The per-tier counts describe what the BUNDLE holds (after the safety gate, merging and caps), so they always match
    the rows the app shows; the removals, the feed cap and the two flags are the engine's own."""
    rel = cli.get("relevance")
    if not isinstance(rel, dict):
        return None
    removed = rel.get("removed") if isinstance(rel.get("removed"), dict) else {}
    intent = rel.get("query_intent")
    return {
        "query_intent": intent[:40] if isinstance(intent, str) and intent.strip() else "topic",
        "pages": _count_tiers(sources),
        "entities": _count_tiers(entities),
        "relationships": _count_tiers(relationships),
        "removed": {
            "gazetteer_context": _int0(removed.get("gazetteer_context")),
            "org_boilerplate": _int0(removed.get("org_boilerplate")),
        },
        "feed_items_capped": _int0(rel.get("feed_items_capped")),
        "filter_fallback": bool(rel.get("filter_fallback")),
        "refined_query_restored": bool(rel.get("refined_query_restored")),
    }


def _page_tiers(cli: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """(by dashed page id, by url) -> {tier, reason, page_kind} from `pages_scraped[]`. 22R leaves `page_id` null, so
    the URL is the usual key; when one page is listed twice the stronger tier wins."""
    by_id: dict[str, dict[str, Any]] = {}
    by_url: dict[str, dict[str, Any]] = {}
    for p in cli.get("pages_scraped") or []:
        if not isinstance(p, dict):
            continue
        tier = tier_of(p.get("relevance"))
        if tier is None:
            continue
        info = {"tier": tier, "reason": p.get("relevance_reason"), "page_kind": page_kind_of(p.get("page_kind"))}
        for key, table in ((p.get("page_id"), by_id), (p.get("url"), by_url)):
            if not key:
                continue
            key = dash_uuid(key) if table is by_id else str(key)
            prev = table.get(key)
            if prev is None or _TIER_RANK[tier] < _TIER_RANK[prev["tier"]]:
                table[key] = info
    return by_id, by_url


def _norm_key(etype: str, value: str) -> tuple[str, str]:
    v = " ".join(value.split())
    return etype, v if etype in {"API_KEY", "JWT_TOKEN"} else v.lower()


def build_bundle(inp: BundleInputs) -> BuiltBundle:
    cli = inp.cli_payload
    raw = RawSecrets()
    pages = load_pages(inp.db_path)
    sanitized, page_info = sanitize_pages(pages)
    page_label = {
        p.get("url"): str(p.get("source") or "") for p in (cli.get("pages_scraped") or []) if p.get("url")
    }
    tier_by_id, tier_by_url = _page_tiers(cli)

    # ---- sources -------------------------------------------------------------------------------------
    sources: list[dict[str, Any]] = []
    for pid, info in page_info.items():
        orig_url = next((p["url"] for p in pages if dash_uuid(p["id"]) == pid), info["url"])
        label = page_label.get(orig_url, "")
        src = {
            "id": pid,
            "kind": source_kind(info["url"], label),
            "name": _source_name(info["url"], label),
            "url": info["url"],
            "fetched_at": info["fetched_at"],
            "excerpt": _excerpt(sanitized[pid]),
        }
        pt = tier_by_id.get(pid) or tier_by_url.get(orig_url)
        if pt is not None:
            src.update(_tier_fields(pt["tier"], pt["reason"]))
            if pt["page_kind"]:
                src["page_kind"] = pt["page_kind"]
        sources.append(src)
    kept_sources = set(page_info)
    dropped_pages = {dash_uuid(p["id"]) for p in pages} - kept_sources

    # ---- entities (merge duplicates, mask sensitive values) ------------------------------------------------
    db_entities = _entity_rows_from_db(inp.db_path)
    dropped: Counter[str] = Counter()
    canonical: dict[str, str] = {}
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[dict[str, Any]] = []
    for e in cli.get("entities") or []:
        etype = normalize_type(e.get("entity_type"))
        eid = dash_uuid(e.get("id"))
        value = str(e.get("canonical_value") or e.get("value") or "").strip()
        if etype is None:
            dropped[str(e.get("entity_type") or "UNKNOWN").upper()] += 1
            continue
        if not value:
            continue
        row = db_entities.get(eid, {})
        page_id = dash_uuid(row["page_id"]) if row.get("page_id") else None
        src_ids = [page_id] if page_id and page_id in kept_sources else []
        if page_id and page_id in dropped_pages:
            continue  # extracted from a page the gate dropped: it must not leave the container
        key = _norm_key(etype, value)
        tier = tier_of(e.get("relevance"))
        existing = by_key.get(key)
        if existing is not None:
            canonical[eid] = existing["id"]
            existing["source_ids"] = sorted(set(existing["source_ids"]) | set(src_ids))
            existing["confidence"] = max(existing["confidence"], clamp01(e.get("confidence")))
            # a merged value keeps its strongest tier (and that tier's reason)
            if tier is not None and stronger_tier(existing.get("relevance"), tier) != existing.get("relevance"):
                existing.pop("relevance_reason", None)
                existing.update(_tier_fields(tier, e.get("relevance_reason")))
            continue
        tags: list[str] = []
        for t in (row.get("extraction_method"), e.get("extraction_method"), e.get("freshness_tag")):
            if t and str(t) not in tags:
                tags.append(str(t))
        if e.get("suppressed"):
            tags.append("suppressed")
        sensitive = is_sensitive_type(etype)
        if sensitive and is_secret_type(etype):
            token = secret_value_token(value)
            out_value, display = token, token.split(" ")[0]
            raw.add(value, display)
            if etype in COMPOUND_SECRET_TYPES:
                for part in re.split(r"[:|;]", value):  # `user@host:password` leaks through either half
                    part = part.strip()
                    raw.add(part, mask_entity_value("EMAIL_ADDRESS", part) if "@" in part else "[redacted]")
        elif sensitive:
            display = mask_entity_value(etype, value)
            out_value = display
            tags.append(f"fp:{fingerprint_prefix(etype, value)}")
            raw.add(value, display)
        else:
            out_value, display = value, mask_entity_value(etype, value)
        item = {
            "id": eid,
            "type": etype,
            "value": out_value,
            "display_value": display,
            "sensitive": sensitive,
            "confidence": clamp01(e.get("confidence")),
            "source_ids": src_ids,
            "tags": tags,
            **_tier_fields(tier, e.get("relevance_reason")),
        }
        first_seen = iso_utc(e.get("first_seen") or row.get("first_seen"))
        if first_seen:
            item["first_seen"] = first_seen
        canonical[eid] = eid
        by_key[key] = item
        order.append(item)
    # Tiered runs keep Direct, then Related, then Background under the entity cap; untiered runs sort as before.
    order.sort(key=lambda x: (_TIER_RANK.get(x.get("relevance"), 0), -x["confidence"]))
    if len(order) > C.MAX_BUNDLE_ENTITIES:
        for gone in order[C.MAX_BUNDLE_ENTITIES :]:
            canonical = {k: v for k, v in canonical.items() if v != gone["id"]}
        order = order[: C.MAX_BUNDLE_ENTITIES]
    entity_ids = {e["id"] for e in order}
    src_of = {e["id"]: set(e["source_ids"]) for e in order}
    tier_by_entity = {e["id"]: e.get("relevance") for e in order}

    # ---- relationships ---------------------------------------------------------------------------------
    rel_pages = _relationship_pages_from_db(inp.db_path)
    relationships: list[dict[str, Any]] = []
    seen_rel: set[tuple[str, str, str]] = set()
    for r in cli.get("relationships") or []:
        a = canonical.get(dash_uuid(r.get("entity_a_id")))
        b = canonical.get(dash_uuid(r.get("entity_b_id")))
        rtype = str(r.get("relationship_type") or "").strip()
        if not a or not b or a == b or a not in entity_ids or b not in entity_ids or not rtype:
            continue
        key = (a, b, rtype)
        if key in seen_rel:
            continue
        seen_rel.add(key)
        evidence = rel_pages.get(dash_uuid(r.get("id")))
        ev = [evidence] if evidence and evidence in kept_sources else sorted(src_of[a] & src_of[b])
        rel_item = {
            "source": a,
            "target": b,
            "type": rtype,
            "weight": clamp01(r.get("confidence"), 1.0),
            "evidence_source_ids": ev,
        }
        # the engine's tier; when an end was merged it may name a value that now has a stronger tier, so the edge
        # is never stronger than the weaker of its two (final) ends
        rtier = tier_of(r.get("relevance"))
        ends = weaker_tier(tier_by_entity.get(a), tier_by_entity.get(b))
        if rtier is not None or ends is not None:
            rel_item["relevance"] = rtier if ends is None else (ends if rtier is None else weaker_tier(rtier, ends))
        relationships.append(rel_item)

    # ---- actors ----------------------------------------------------------------------------------------
    profiles = _actor_profiles_from_db(inp.db_path)
    actors: dict[str, dict[str, Any]] = {}
    for e in order:
        if e["type"] not in ACTOR_TYPES:
            continue
        handle = e["value"].strip()
        key = handle.lstrip("@").lower()
        actor = actors.get(key)
        if actor is None:
            prof = profiles.get(key, {})
            aliases = []
            for value, atype in prof.get("aliases", []):
                if atype in _ACTOR_ALIAS_SKIP_TYPES or not value or value.lower() == key:
                    continue
                cleaned = raw.scrub(str(value))[:200]
                if cleaned and cleaned != "[redacted-phone]" and cleaned not in aliases:
                    aliases.append(cleaned)
            actor = {
                "id": "actor_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12],
                "handle": handle,
                "aliases": aliases,
                "entity_ids": [],
            }
            if prof.get("first_seen"):
                actor["first_seen"] = prof["first_seen"]
            if prof.get("last_seen"):
                actor["last_seen"] = prof["last_seen"]
            actors[key] = actor
        actor["entity_ids"].append(e["id"])

    # ---- communities -----------------------------------------------------------------------------------
    groups: dict[int, list[str]] = {}
    comm = cli.get("communities") or {}
    if isinstance(comm, dict):
        for ent, cid in comm.items():
            eid = canonical.get(dash_uuid(ent))
            if eid in entity_ids and isinstance(cid, int) and cid >= 0:
                groups.setdefault(cid, [])
                if eid not in groups[cid]:
                    groups[cid].append(eid)
    communities = [{"id": cid, "entity_ids": ids} for cid, ids in sorted(groups.items())]

    bundle = {
        "schema_version": 1,
        "run_id": inp.run_id,
        "query": inp.query,
        "refined_queries": [q for q in [cli.get("refined_query")] if q],
        "depth": inp.depth,
        "started_at": inp.started_at,
        "completed_at": inp.completed_at,
        "engine_version": inp.engine_version,
        "summary": build_summary(cli, len(sources), raw, [x["url"] for x in sources]),
        "entities": order,
        "relationships": relationships,
        "actors": list(actors.values()),
        "communities": communities,
        "sources": sources,
        "metrics": inp.metrics,
    }
    relevance = build_relevance(cli, sources, order, relationships)
    if relevance is not None:
        bundle["relevance"] = relevance
    if dropped:
        bundle["metrics"]["dropped_entities"] = dict(dropped)
    return BuiltBundle(bundle, raw, sanitized, page_info, dict(dropped))


def scrub_bundle(bundle: dict[str, Any], raw: RawSecrets) -> dict[str, Any]:
    """`deep_scrub`, then the contract's length limits again: a masked form can be longer than the raw value it
    replaces (a 5-character secret becomes `[redacted]`), so an excerpt cut to 500 characters before masking can
    leave masking at 505 and fail the schema (R2b: a standard run ended `failed: error` this way)."""
    out = deep_scrub(bundle, raw)
    for src in out.get("sources") or []:
        if isinstance(src.get("excerpt"), str):
            src["excerpt"] = src["excerpt"][: C.EXCERPT_MAX_CHARS]
    for item in (out.get("sources") or []) + (out.get("entities") or []):
        if isinstance(item.get("relevance_reason"), str):
            item["relevance_reason"] = item["relevance_reason"][:REASON_MAX]
    return out


def deep_scrub(obj: Any, raw: RawSecrets, skip: tuple[str, ...] = ("query", "refined_queries")) -> Any:
    """Replace every raw sensitive value found in any string of `obj` (the user's own query and its refinements are
    left alone: they are the user's input, not page content)."""
    if isinstance(obj, str):
        return raw.replace_pairs(obj)
    if isinstance(obj, list):
        return [deep_scrub(x, raw, skip) for x in obj]
    if isinstance(obj, dict):
        return {k: (v if k in skip else deep_scrub(v, raw, skip)) for k, v in obj.items()}
    return obj


def integrity_problems(b: dict[str, Any]) -> list[str]:
    """Referential integrity the JSON Schema cannot express (port of checkBundleIntegrity in engine-client)."""
    problems: list[str] = []
    entity_ids = {e["id"] for e in b["entities"]}
    source_ids = {s["id"] for s in b["sources"]}
    if len(entity_ids) != len(b["entities"]):
        problems.append("duplicate entity ids")
    if len(source_ids) != len(b["sources"]):
        problems.append("duplicate source ids")
    for e in b["entities"]:
        problems += [f"entity {e['id']}: unknown source" for s in e["source_ids"] if s not in source_ids]
    for r in b["relationships"]:
        if r["source"] not in entity_ids or r["target"] not in entity_ids:
            problems.append("relationship: unknown entity")
        problems += ["relationship: unknown source" for s in r["evidence_source_ids"] if s not in source_ids]
    for a in b["actors"]:
        problems += [f"actor {a['id']}: unknown entity" for i in a["entity_ids"] if i not in entity_ids]
    for c in b["communities"]:
        problems += [f"community {c['id']}: unknown entity" for i in c["entity_ids"] if i not in entity_ids]
    return problems
