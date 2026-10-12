"""Build results_e1b_confirm.jsonl from a directory of downloaded result files.

Each result.json carries its own query/depth/variant, so no cell ordering is needed.
Usage: python -m baseline.e1b_collect_dir /tmp/va-e1b-results2 results_e1b_confirm.jsonl
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from baseline.matrix_runner import summarize_row


def main() -> None:
    src, out = Path(sys.argv[1]), Path(__file__).resolve().parent / sys.argv[2]
    counts: dict[str, int] = {}
    with out.open("w", encoding="utf-8") as fh:
        for path in sorted(src.glob("*.json")):
            result = json.loads(path.read_text())
            m = result.get("metrics") or {}
            row = summarize_row(result)
            row["status"] = m.get("status") or ("ok" if m.get("exit_code") == 0 else "error")
            for k in ("stage_ms_events", "progress_counts", "progress_terminal", "tor_bootstrap_attempts",
                      "stagger_s", "summary_kind", "summary_len", "variant_env", "peak_rss_mb"):
                row[k] = m.get(k)
            counts[row["status"]] = counts.get(row["status"], 0) + 1
            fh.write(json.dumps(row, default=str) + "\n")
    print(counts)


if __name__ == "__main__":
    main()
