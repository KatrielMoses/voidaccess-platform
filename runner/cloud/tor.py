"""Embedded Tor client: baked consensus, bootstrap retried, start jitter. Client only: no ORPort, no exit relay,
no bridge relay configuration (guarantee 2).

The image warms the consensus and descriptor cache into TOR_DATA_DIR at build time, so a run bootstraps from
cached directory state (E1B: bootstrap p50 about 3 s).
"""

from __future__ import annotations

import random
import subprocess
import time
from pathlib import Path
from typing import Callable

from . import constants as C

TOR_DATA_DIR = Path("/var/lib/tor-cloud")
TOR_LOG_PATH = Path("/tmp/va-tor.log")
TOR_CONSOLE_PATH = Path("/tmp/va-tor.console")
TOR_TORRC_PATH = Path("/tmp/va-tor.torrc")
BOOTSTRAPPED_MARKER = "Bootstrapped 100%"
POLL_INTERVAL_S = 0.25

TORRC_CLIENT = """SocksPort 127.0.0.1:9050
DataDirectory {data_dir}
Log notice file {log}
"""


class TorError(RuntimeError):
    pass


def start_jitter_s(rng: random.Random | None = None) -> float:
    return (rng or random).uniform(0.0, C.TOR_START_JITTER_MAX_S)


def _start_once(timeout_s: float, should_stop: Callable[[], bool]) -> subprocess.Popen[bytes]:
    TOR_DATA_DIR.mkdir(parents=True, exist_ok=True)
    TOR_DATA_DIR.chmod(0o700)
    TOR_LOG_PATH.unlink(missing_ok=True)
    TOR_TORRC_PATH.write_text(TORRC_CLIENT.format(data_dir=TOR_DATA_DIR, log=TOR_LOG_PATH), encoding="utf-8")
    proc = subprocess.Popen(
        ["tor", "-f", str(TOR_TORRC_PATH)], stdout=TOR_CONSOLE_PATH.open("wb"), stderr=subprocess.STDOUT
    )
    end = time.monotonic() + timeout_s
    while time.monotonic() < end:
        if should_stop():
            stop_tor(proc)
            raise TorError("stopped")
        if proc.poll() is not None:
            raise TorError(f"tor exited early with code {proc.returncode}")
        if TOR_LOG_PATH.exists() and BOOTSTRAPPED_MARKER in TOR_LOG_PATH.read_text(
            encoding="utf-8", errors="replace"
        ):
            return proc
        time.sleep(POLL_INTERVAL_S)
    stop_tor(proc)
    raise TorError(f"tor bootstrap exceeded {timeout_s:.0f}s")


def start_tor_with_retry(
    should_stop: Callable[[], bool] = lambda: False,
    attempts: int = C.TOR_BOOTSTRAP_ATTEMPTS,
    timeout_s: float = C.TOR_BOOTSTRAP_TIMEOUT_S,
) -> tuple[subprocess.Popen[bytes], float, int]:
    """Start tor; returns (process, bootstrap_ms covering every attempt, attempts used)."""
    t0 = time.monotonic()
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            proc = _start_once(timeout_s, should_stop)
            return proc, (time.monotonic() - t0) * 1000.0, attempt
        except TorError as exc:
            last = exc
            if str(exc) == "stopped":
                raise
            print(f"tor bootstrap attempt {attempt} failed: {exc}; last tor log lines: {_log_tail()}", flush=True)
    raise TorError(f"tor bootstrap failed after {attempts} attempts: {last}")


def _log_tail(n: int = 4) -> str:
    """Tor's own last notices (bootstrap progress, warnings): no query, URL or secret ever reaches this log."""
    try:
        lines = TOR_LOG_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return "(no log)"
    return " | ".join(line.strip()[:200] for line in lines[-n:]) or "(empty)"


def stop_tor(proc: subprocess.Popen[bytes] | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=C.TOR_STOP_GRACE_S)
    except subprocess.TimeoutExpired:
        proc.kill()
