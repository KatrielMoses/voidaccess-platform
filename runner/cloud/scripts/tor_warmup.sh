#!/usr/bin/env bash
# Build-time Tor warm-up (Dockerfile): bootstrap a client-only Tor once so the image ships a complete consensus and
# descriptor cache in /var/lib/tor-cloud, and a run bootstraps from it in seconds.
# The build FAILS unless Tor reaches "Bootstrapped 100%". On a failed attempt it prints Tor's exit code (or "still
# running" when the attempt timed out) and the last lines of its console and log, then retries.
# R2b: image c66b9a0-8b4519c shipped with a warm-up that stopped at 55% (Tor had exited; nothing was logged), and its
# first production run timed out bootstrapping.
set -uo pipefail

DATA_DIR="${TOR_DATA_DIR:-/var/lib/tor-cloud}"
ATTEMPTS="${TOR_WARMUP_ATTEMPTS:-3}"
TIMEOUT_S="${TOR_WARMUP_TIMEOUT_S:-180}"
SETTLE_S="${TOR_WARMUP_SETTLE_S:-15}"   # keep Tor up after 100% so the remaining descriptors land in the cache
LOG=/tmp/tor-warm.log
CONSOLE=/tmp/tor-warm.console
TORRC=/tmp/tor-warm.torrc

printf 'SocksPort 127.0.0.1:9050\nDataDirectory %s\nLog notice file %s\n' "$DATA_DIR" "$LOG" > "$TORRC"
tor --version | head -n 1

for attempt in $(seq 1 "$ATTEMPTS"); do
  rm -f "$LOG" "$CONSOLE"
  tor -f "$TORRC" > "$CONSOLE" 2>&1 &
  pid=$!
  ok=0
  for _ in $(seq 1 "$TIMEOUT_S"); do
    if grep -q 'Bootstrapped 100%' "$LOG" 2>/dev/null; then ok=1; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if [[ $ok == 1 ]]; then
    sleep "$SETTLE_S"
    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    echo "tor warm-up: Bootstrapped 100% on attempt $attempt"
    tail -n 3 "$LOG"
    ls -l "$DATA_DIR"
    rm -f "$LOG" "$CONSOLE" "$TORRC"
    exit 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    status="still running after ${TIMEOUT_S}s"
    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  else
    wait "$pid"; status="exited with code $?"
  fi
  echo "tor warm-up attempt $attempt failed: tor $status"
  echo "--- console (last 20 lines)"; tail -n 20 "$CONSOLE" 2>/dev/null
  echo "--- log (last 20 lines)"; tail -n 20 "$LOG" 2>/dev/null
done

echo "FATAL: tor warm-up never reached Bootstrapped 100% in $ATTEMPTS attempts" >&2
exit 1
