"""Keeps the query, the callback secret and tokens out of anything the runner prints.

Guarantee 1: the query never appears in a log line. The engine's own loggers (and exception messages
from libraries) are outside this package, so stdout, stderr and the logging module are all wrapped to
replace every registered secret before it is written. Registered values are the query, its words when
the query is long enough to be quoted in pieces, the callback secret, the OpenRouter key and tokens.
"""

from __future__ import annotations

import logging
import re
import sys
import threading

REDACTED = "[redacted]"
# A bare short word ("the") would shred normal log lines; only registered strings of this length and
# longer are replaced individually.
MIN_SECRET_LEN = 6

_lock = threading.Lock()
_secrets: list[str] = []
_pattern: re.Pattern[str] | None = None


def _rebuild() -> None:
    global _pattern
    if not _secrets:
        _pattern = None
        return
    ordered = sorted(set(_secrets), key=len, reverse=True)
    _pattern = re.compile("|".join(re.escape(s) for s in ordered), re.IGNORECASE)


def register(value: str | None) -> None:
    """Register a sensitive string (and, for multi-word strings, its normalized forms)."""
    if not value:
        return
    value = value.strip()
    forms = {value, " ".join(value.split())}
    with _lock:
        for form in forms:
            if len(form) >= MIN_SECRET_LEN and form not in _secrets:
                _secrets.append(form)
        _rebuild()


def clear() -> None:
    with _lock:
        _secrets.clear()
        _rebuild()


def scrub(text: str) -> str:
    pattern = _pattern
    return pattern.sub(REDACTED, text) if pattern else text


SAFE_MESSAGE_MAX = 200
_URL_RE = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)
_ONION_RE = re.compile(r"\b[a-z2-7]{16,56}\.onion\b\S*", re.IGNORECASE)
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")


def safe_exception_message(exc: BaseException) -> str:
    """An exception's message fit for a log line: registered secrets (query, refined queries, keys) replaced, URLs,
    onion hosts and e-mail addresses removed, whitespace collapsed, at most SAFE_MESSAGE_MAX characters. The runner's
    own messages (e.g. `bundle failed schema validation: sources/0/excerpt: maxLength`) survive intact."""
    try:
        text = str(exc)
    except Exception:
        return "(unprintable)"
    text = _URL_RE.sub("[url]", text)
    text = _ONION_RE.sub("[onion]", text)
    text = _EMAIL_RE.sub("[email]", text)
    text = scrub(" ".join(text.split()))
    return (text[: SAFE_MESSAGE_MAX - 1] + "…") if len(text) > SAFE_MESSAGE_MAX else (text or "(no message)")


def contains_secret(text: str) -> bool:
    pattern = _pattern
    return bool(pattern and pattern.search(text))


class ScrubbingStream:
    """File-like wrapper that scrubs everything written through it."""

    def __init__(self, inner):
        self._inner = inner

    def write(self, data):
        if isinstance(data, bytes):
            data = data.decode("utf-8", errors="replace")
        return self._inner.write(scrub(data))

    def flush(self):
        self._inner.flush()

    def isatty(self):
        return False

    def __getattr__(self, name):
        return getattr(self._inner, name)


class ScrubbingFilter(logging.Filter):
    """Keeps the exception type but not its text or traceback (both can quote the query or a page)."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = scrub(record.getMessage())
        except Exception:
            message = REDACTED
        if record.exc_info:
            etype = record.exc_info[0]
            message = f"{message} [{getattr(etype, '__name__', 'exception')}]"
            record.exc_info = None
            record.exc_text = None
        record.msg, record.args = message, None
        return True


_installed: dict[str, object] | None = None


def install_stream_scrubbers() -> None:
    """Wrap stdout/stderr, and scrub every log record (the record factory covers every logger, wherever its handlers
    are attached)."""
    global _installed
    if _installed is not None:
        return
    old_factory = logging.getLogRecordFactory()
    _installed = {"stdout": sys.stdout, "stderr": sys.stderr, "factory": old_factory}
    sys.stdout = ScrubbingStream(sys.stdout)  # type: ignore[assignment]
    sys.stderr = ScrubbingStream(sys.stderr)  # type: ignore[assignment]
    flt = ScrubbingFilter()

    def factory(*args, **kwargs):
        record = old_factory(*args, **kwargs)
        flt.filter(record)
        return record

    logging.setLogRecordFactory(factory)


def uninstall_stream_scrubbers() -> None:
    """Undo `install_stream_scrubbers` (tests)."""
    global _installed
    if _installed is None:
        return
    sys.stdout, sys.stderr = _installed["stdout"], _installed["stderr"]  # type: ignore[assignment]
    logging.setLogRecordFactory(_installed["factory"])  # type: ignore[arg-type]
    _installed = None
