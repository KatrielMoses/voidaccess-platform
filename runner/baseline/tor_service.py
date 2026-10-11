"""Start embedded Tor client and measure bootstrap time."""

from __future__ import annotations

import subprocess
import time
from pathlib import Path

from pacing import scale_timeout

_TOR_BOOTSTRAP_PROBE_BASE_S = 180.0
TOR_BOOTSTRAP_TIMEOUT_S = scale_timeout(_TOR_BOOTSTRAP_PROBE_BASE_S)
TOR_LOG_POLL_INTERVAL_S = 0.25
TOR_STOP_GRACE_S = 10.0
TOR_BOOTSTRAPPED_MARKER = "Bootstrapped 100%"

TOR_DATA_DIR = Path("/var/lib/tor-baseline")
TOR_LOG_PATH = Path("/tmp/voidaccess-baseline-tor.log")
TOR_CONSOLE_PATH = Path("/tmp/voidaccess-baseline-tor.console")
TOR_TORRC_PATH = Path("/tmp/voidaccess-baseline.torrc")

# Client only: no ORPort, no ExitRelay, no bridge relay configuration.
_TORRC_CLIENT = f"""SocksPort 127.0.0.1:9050
DataDirectory {TOR_DATA_DIR}
Log notice file {TOR_LOG_PATH}
"""


def _log_tail(lines: int = 5) -> str:
    parts: list[str] = []
    for path in (TOR_CONSOLE_PATH, TOR_LOG_PATH):
        if path.exists():
            parts += path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
    return " | ".join(parts) or "no tor output"


def start_tor() -> tuple[subprocess.Popen[bytes], float]:
    """Launch tor; return (process, bootstrap_ms).

    The SOCKS port listens before circuits exist, so readiness is the
    ``Bootstrapped 100%`` log line, not an open port.
    """
    TOR_DATA_DIR.mkdir(parents=True, exist_ok=True)
    TOR_DATA_DIR.chmod(0o700)
    TOR_LOG_PATH.unlink(missing_ok=True)
    TOR_TORRC_PATH.write_text(_TORRC_CLIENT, encoding="utf-8")

    start = time.monotonic()
    proc = subprocess.Popen(
        ["tor", "-f", str(TOR_TORRC_PATH)],
        stdout=TOR_CONSOLE_PATH.open("wb"),
        stderr=subprocess.STDOUT,
    )
    deadline = start + TOR_BOOTSTRAP_TIMEOUT_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"tor exited early with code {proc.returncode}: {_log_tail()}")
        if TOR_LOG_PATH.exists() and TOR_BOOTSTRAPPED_MARKER in TOR_LOG_PATH.read_text(
            encoding="utf-8", errors="replace"
        ):
            return proc, (time.monotonic() - start) * 1000.0
        time.sleep(TOR_LOG_POLL_INTERVAL_S)
    proc.terminate()
    raise TimeoutError(f"tor bootstrap exceeded {TOR_BOOTSTRAP_TIMEOUT_S:.0f}s")


def stop_tor(proc: subprocess.Popen[bytes] | None) -> None:
    if proc is None:
        return
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=TOR_STOP_GRACE_S)
        except subprocess.TimeoutExpired:
            proc.kill()
