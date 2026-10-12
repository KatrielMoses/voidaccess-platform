"""E1B engine-health probe as a Cloud Run Job task (Tor runs inside the container).

Runs benchmark.engine_probe.probe_engines over Tor with PROBE_SAMPLE queries (>= 3
samples per engine) at the default `normal` pacing, then uploads the artifact to
gs://<bucket>/baseline/e1b-probe/<PROBE_ID>/probe.json. No LLM, no secrets.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from baseline.constants import GCS_BASE_PREFIX
from baseline.storage import upload_json
from baseline.tor_service import start_tor_with_retry, stop_tor

PROBE_SAMPLE_DEFAULT = 4


def main() -> None:
    probe_id = os.environ.get("PROBE_ID", "probe")
    sample = int(os.environ.get("PROBE_SAMPLE", PROBE_SAMPLE_DEFAULT))
    os.environ.setdefault("JWT_SECRET", "probe-not-a-secret")
    os.environ["TOR_PROXY_HOST"], os.environ["TOR_PROXY_PORT"] = "127.0.0.1", "9050"
    out = Path("/tmp/probe.json")
    proc = None
    try:
        proc, boot_ms, attempts = start_tor_with_retry()
        print(f"tor bootstrapped in {boot_ms:.0f} ms ({attempts} attempt(s))", flush=True)
        from benchmark.engine_probe import probe_engines

        artifact = probe_engines(sample_size=sample, out_path=out)
    finally:
        stop_tor(proc)
    uri = upload_json(f"{GCS_BASE_PREFIX}/e1b-probe/{probe_id}/probe.json", json.loads(out.read_text()))
    print(uri, flush=True)
    sys.exit(0 if artifact else 1)


if __name__ == "__main__":
    main()
