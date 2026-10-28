"""Shared pieces of the content-safety scan and purge (H211). Operator tools: the runner never imports this.

Needs the 2.1.1 engine importable (its detector is the single source of truth), and for the database
`psycopg` 3 (`pip install "psycopg[binary]"`). Nothing here prints, logs or returns flagged text: findings are
ids, object names, rule ids and SHA-256 hashes.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Callable, Iterator, Optional, Protocol
from urllib.parse import quote

MANIFEST_VERSION = 1
SUMMARY_NOTICE = "Part of this summary was removed under our content policy."
PAGES_NAME = "pages.jsonl.gz"
# Entity types whose value is a URL or a host (the engine's URL entity gate).
URL_ENTITY_TYPES = frozenset({"ONION_URL", "ONION_ADDRESS", "URL", "PASTE_URL", "DOMAIN", "DOMAIN_NAME"})


def sha256(data: str | bytes) -> str:
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


# ---- the engine's detector ---------------------------------------------------------------------------------


def _cs():
    from utils import content_safety

    return content_safety


def require_detector() -> dict[str, Any]:
    """Fail unless the engine's 2.1.1 detector is importable. Returns what the manifest records about it."""
    cs = _cs()
    if not hasattr(cs, "detect_prohibited") or not hasattr(cs, "blocked_host_hashes"):
        raise SystemExit("the engine on the path predates 2.1.1: install voidaccess==2.1.1")
    try:
        from importlib.metadata import version

        engine = version("voidaccess")
    except Exception:
        engine = "unknown"
    return {"engine_version": engine, "blocked_hosts": len(cs.blocked_host_hashes())}


def text_rule(text: str | None) -> Optional[str]:
    """The rule a page-derived text trips, or None. Fail-closed: an error is a hit."""
    if not text:
        return None
    try:
        cs = _cs()
        if not cs.sanitize_content(text)[1]:
            return None
        return cs.detect_prohibited(text) or "phrase"
    except Exception:
        return "error"


def url_rule(url: str | None) -> Optional[str]:
    if not url:
        return None
    try:
        cs = _cs()
        if not cs.is_blocked_url(url)[0]:
            return None
        return "host" if cs.is_blocked_host(url) else "url"
    except Exception:
        return "error"


def entity_rule(entity_type: str | None, value: str | None) -> Optional[str]:
    if not value:
        return None
    try:
        return "entity" if _cs().entity_is_unsafe(str(entity_type or "").upper(), value) else None
    except Exception:
        return "error"


# ---- object stores ------------------------------------------------------------------------------------------


class ObjectStore(Protocol):
    def list(self, prefix: str) -> Iterator[str]: ...
    def read(self, name: str) -> Optional[bytes]: ...
    def replace(self, name: str, data: bytes, content_type: str) -> None:
        """Write `data` as the only version of `name`."""
    def delete_all(self, name: str) -> int:
        """Delete every version of `name`; returns how many were deleted."""


class LocalStore:
    """A directory standing in for a bucket (tests, and a copy of a bucket made with `gcloud storage cp`).
    Old versions live in `.versions/<name>/<n>`, so version handling is testable."""

    def __init__(self, root: str | Path, read_only: bool = False):
        self.root = Path(root).resolve()
        self.read_only = read_only

    def _path(self, name: str) -> Path:
        p = (self.root / name).resolve()
        if self.root not in p.parents:
            raise ValueError("object name escapes the store")
        return p

    def _versions(self, name: str) -> Path:
        return self.root / ".versions" / name

    def list(self, prefix: str) -> Iterator[str]:
        for p in sorted(self.root.rglob("*")):
            rel = p.relative_to(self.root).as_posix()
            if p.is_file() and not rel.startswith(".versions/") and rel.startswith(prefix):
                yield rel

    def read(self, name: str) -> Optional[bytes]:
        p = self._path(name)
        return p.read_bytes() if p.is_file() else None

    def replace(self, name: str, data: bytes, content_type: str) -> None:
        if self.read_only:
            raise PermissionError("read-only store")
        p = self._path(name)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        vdir = self._versions(name)
        if vdir.is_dir():
            for v in vdir.iterdir():
                v.unlink()

    def delete_all(self, name: str) -> int:
        if self.read_only:
            raise PermissionError("read-only store")
        n = 0
        p = self._path(name)
        if p.is_file():
            p.unlink()
            n += 1
        vdir = self._versions(name)
        if vdir.is_dir():
            for v in vdir.iterdir():
                v.unlink()
                n += 1
        return n


def adc_access_token() -> str:
    """GCS_ACCESS_TOKEN, else an Application Default Credentials token from gcloud."""
    token = os.environ.get("GCS_ACCESS_TOKEN", "").strip()
    if token:
        return token
    out = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        check=True, capture_output=True, text=True,
    )
    return out.stdout.strip()


class GcsStore:
    """Cloud Storage through the JSON API (httpx, an engine dependency), with an ADC access token."""

    API = "https://storage.googleapis.com/storage/v1/b/{bucket}/o"
    UPLOAD = "https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={name}"

    def __init__(self, bucket: str, read_only: bool = False, token: Callable[[], str] = adc_access_token, client=None):
        import httpx

        self.bucket = bucket
        self.read_only = read_only
        self._token = token()
        self._client = client or httpx.Client(timeout=60.0)

    def _h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}

    def _items(self, prefix: str, versions: bool) -> Iterator[dict[str, Any]]:
        params: dict[str, str] = {"prefix": prefix, "fields": "items(name,generation),nextPageToken"}
        if versions:
            params["versions"] = "true"
        while True:
            r = self._client.get(self.API.format(bucket=self.bucket), params=params, headers=self._h())
            r.raise_for_status()
            body = r.json()
            yield from body.get("items", [])
            if not body.get("nextPageToken"):
                return
            params["pageToken"] = body["nextPageToken"]

    def list(self, prefix: str) -> Iterator[str]:
        for item in self._items(prefix, versions=False):
            yield item["name"]

    def read(self, name: str) -> Optional[bytes]:
        r = self._client.get(
            f"{self.API.format(bucket=self.bucket)}/{quote(name, safe='')}", params={"alt": "media"}, headers=self._h()
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.content

    def _delete_generations(self, name: str, keep: Optional[str] = None) -> int:
        n = 0
        for item in list(self._items(name, versions=True)):
            if item["name"] != name or str(item.get("generation")) == keep:
                continue
            r = self._client.delete(
                f"{self.API.format(bucket=self.bucket)}/{quote(name, safe='')}",
                params={"generation": str(item["generation"])},
                headers=self._h(),
            )
            if r.status_code not in (200, 204, 404):
                r.raise_for_status()
            n += 1
        return n

    def replace(self, name: str, data: bytes, content_type: str) -> None:
        if self.read_only:
            raise PermissionError("read-only store")
        r = self._client.post(
            self.UPLOAD.format(bucket=self.bucket, name=quote(name, safe="")),
            content=data,
            headers={**self._h(), "Content-Type": content_type},
        )
        r.raise_for_status()
        self._delete_generations(name, keep=str(r.json().get("generation")))

    def delete_all(self, name: str) -> int:
        if self.read_only:
            raise PermissionError("read-only store")
        return self._delete_generations(name)


def open_store(bucket: Optional[str], directory: Optional[str], read_only: bool) -> Optional[ObjectStore]:
    if directory:
        return LocalStore(directory, read_only=read_only)
    if bucket:
        return GcsStore(bucket, read_only=read_only)
    return None


# ---- runs bucket objects -------------------------------------------------------------------------------------


def read_pages(data: bytes) -> list[dict[str, Any]]:
    return [json.loads(line) for line in gzip.decompress(data).decode("utf-8").splitlines() if line.strip()]


def write_pages(records: list[dict[str, Any]]) -> bytes:
    """The runner's pages.jsonl.gz encoding (runner/cloud/archive.py)."""
    body = "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in records)
    return gzip.compress(body.encode("utf-8"), mtime=0)


def page_record_rule(record: dict[str, Any]) -> Optional[str]:
    return url_rule(record.get("url")) or text_rule(record.get("text"))


def blob_rule(data: bytes) -> Optional[str]:
    """Rule for a stored artifact (bundle, export): gunzipped when gzipped, read as UTF-8."""
    if data[:2] == b"\x1f\x8b":
        try:
            data = gzip.decompress(data)
        except OSError:
            pass
    return text_rule(data.decode("utf-8", errors="replace"))


def run_id_of(name: str) -> Optional[str]:
    parts = name.split("/")
    return parts[1] if len(parts) >= 3 and parts[0] == "runs" else None


# ---- database ------------------------------------------------------------------------------------------------


def connect(dsn: str, read_only: bool):
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover - environment problem
        raise SystemExit('psycopg 3 is required: pip install "psycopg[binary]"') from exc
    conn = psycopg.connect(dsn, autocommit=True)
    if read_only:
        conn.execute("SET default_transaction_read_only = on")
        if conn.execute("SHOW default_transaction_read_only").fetchone()[0] != "on":
            raise SystemExit("could not make the session read-only")
        conn.read_only = True
    return conn


def rows(conn, sql: str, params: Any = None) -> list[dict[str, Any]]:
    cur = conn.execute(sql, params)
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]


def load_manifest(path: str | Path) -> dict[str, Any]:
    m = json.loads(Path(path).read_text(encoding="utf-8"))
    if m.get("manifest_version") != MANIFEST_VERSION:
        raise SystemExit(f"unsupported manifest version {m.get('manifest_version')!r}")
    return m


def print_table(title: str, counts: dict[str, int]) -> None:
    print(title)
    width = max([len(k) for k in counts] + [4])
    for k in sorted(counts):
        print(f"  {k.ljust(width)}  {counts[k]:>7}")
    if not counts:
        print("  (none)")
