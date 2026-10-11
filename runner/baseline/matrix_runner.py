"""Drive the E0 query×depth matrix on Cloud Run Jobs."""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import httpx
import yaml

from baseline.constants import (
    ARTIFACT_REPO,
    CLOUD_RUN_GIB_PER_S_USD,
    COMPARE_SUBSET_SIZE,
    CLOUD_RUN_PRICING_URL,
    CLOUD_RUN_VCPU_PER_S_USD,
    FLASH_COMPARE_MODEL,
    GCS_RESULT_VISIBILITY_WAIT_S,
    MIN_LIMIT_REMAINING_USD,
    SECRET_OPENROUTER_KEY,
    GCP_PROJECT,
    GCP_REGION,
    IMAGE_NAME,
    JOB_NAME,
    MAX_MATRIX_JOB_EXECUTIONS,
    MAX_OPENROUTER_USD,
    MAX_COST_CENTS_PER_CREDIT,
    OPENROUTER_HARD_KEY_LIMIT_USD,
    RUNNER_SERVICE_ACCOUNT,
    TASK_TIMEOUT_SECONDS,
)
from baseline.openrouter import fetch_key_usage, provisioning_secret_available
from baseline.policy import load_queries
from baseline.storage import download_result

_PKG = Path(__file__).resolve().parent
_STATE_PATH = _PKG / "matrix_state.json"
_RESULTS_CSV = _PKG / "results.csv"
_RESULTS_JSONL = _PKG / "results.jsonl"


@dataclass(frozen=True)
class Cell:
    query_id: str
    depth: str
    variant: str
    vcpu: str
    memory_gib: str
    measure_llm_cost: bool
    safety_bypass: bool
    model_override: str | None = None

    @property
    def key(self) -> str:
        parts = [self.query_id, self.depth, self.variant, f"cpu{self.vcpu}", f"mem{self.memory_gib}"]
        if self.model_override:
            parts.append("model-" + self.model_override.replace("/", "_"))
        if self.safety_bypass:
            parts.append("bypass")
        return "|".join(parts)


def _gcloud_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("CLOUDSDK_ACTIVE_CONFIG_NAME", "voidaccess")
    return env


def _run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        env=_gcloud_env(),
        text=True,
        capture_output=True,
        check=check,
    )


def fetch_cloud_run_rates() -> dict[str, Any]:
    """Verify the recorded instance-based rates against the live pricing page."""
    fetched_at = datetime.now(timezone.utc).isoformat()
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        html = client.get(CLOUD_RUN_PRICING_URL).text
    for rate in (f"${CLOUD_RUN_VCPU_PER_S_USD:.6f}", f"${CLOUD_RUN_GIB_PER_S_USD:.6f}"):
        if rate not in html:
            raise SystemExit(f"Cloud Run rate {rate} not on live pricing page; update constants")
    return {
        "url": CLOUD_RUN_PRICING_URL,
        "fetched_at": fetched_at,
        "vcpu_per_second_usd": CLOUD_RUN_VCPU_PER_S_USD,
        "gib_per_second_usd": CLOUD_RUN_GIB_PER_S_USD,
    }


def read_openrouter_key() -> str:
    """Read the shared key from Secret Manager into memory (never printed or written)."""
    proc = _run(
        ["gcloud", "secrets", "versions", "access", "latest", f"--secret={SECRET_OPENROUTER_KEY}"],
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit("cannot read openrouter-api-key from Secret Manager")
    return proc.stdout.strip()


def iter_matrix_cells() -> Iterator[Cell]:
    queries = load_queries()
    depths = ("quick", "standard", "deep")
    qids = sorted(queries.keys())

    for depth in depths:
        for qid in qids:
            yield Cell(
                query_id=qid,
                depth=depth,
                variant="default",
                vcpu="1",
                memory_gib="2",
                measure_llm_cost=True,
                safety_bypass=False,
            )

    for qid in qids[:COMPARE_SUBSET_SIZE]:
        yield Cell(
            query_id=qid,
            depth="standard",
            variant="vcpu_compare",
            vcpu="2",
            memory_gib="4",
            measure_llm_cost=False,
            safety_bypass=False,
        )

    for qid in qids[:COMPARE_SUBSET_SIZE]:
        yield Cell(
            query_id=qid,
            depth="standard",
            variant="bypass_compare",
            vcpu="1",
            memory_gib="2",
            measure_llm_cost=False,
            safety_bypass=True,
        )

    flash_model = os.environ.get("BASELINE_FLASH_MODEL", FLASH_COMPARE_MODEL)
    for qid in qids[:COMPARE_SUBSET_SIZE]:
        yield Cell(
            query_id=qid,
            depth="standard",
            variant="flash_compare",
            vcpu="1",
            memory_gib="2",
            measure_llm_cost=True,
            safety_bypass=False,
            model_override=flash_model,
        )


def load_state() -> dict[str, Any]:
    if _STATE_PATH.exists():
        return json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    return {"completed": {}, "executions": 0, "openrouter_spent_usd": 0.0}


def save_state(state: dict[str, Any]) -> None:
    _STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def deploy_job(image: str) -> None:
    cmd = [
        "gcloud", "run", "jobs", "deploy", JOB_NAME,
        f"--project={GCP_PROJECT}",
        f"--region={GCP_REGION}",
        f"--image={image}",
        f"--service-account={RUNNER_SERVICE_ACCOUNT}",
        f"--task-timeout={TASK_TIMEOUT_SECONDS}s",
        "--cpu=1",
        "--memory=2Gi",
        "--max-retries=0",
        "--set-env-vars",
        f"ENGINE_GIT_SHA={os.environ.get('ENGINE_GIT_SHA','')}",
        "--set-secrets=OPENROUTER_API_KEY=openrouter-api-key:latest",
        "--command=python",
        "--args=-m,baseline.run_one",
    ]
    proc = _run(cmd)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise SystemExit(proc.returncode)


def execute_cell(cell: Cell, rates: dict[str, Any]) -> tuple[str, int, str]:
    """Run one job execution; returns (run_id, gcloud exit code, stderr tail)."""
    import base64

    run_id = str(uuid.uuid4())
    rates_b64 = base64.b64encode(json.dumps(rates).encode("utf-8")).decode("ascii")
    env_pairs = [
        f"RUN_ID={run_id}",
        f"QUERY_ID={cell.query_id}",
        f"DEPTH={cell.depth}",
        f"RUN_VARIANT={cell.variant}",
        f"MEASURE_LLM_COST={'1' if cell.measure_llm_cost else '0'}",
        f"SAFETY_BYPASS={'1' if cell.safety_bypass else '0'}",
        f"BASELINE_VCPU={cell.vcpu}",
        f"BASELINE_MEMORY_GIB={cell.memory_gib}",
        f"CLOUD_RUN_RATES_B64={rates_b64}",
    ]
    if cell.model_override:
        env_pairs.append(f"MODEL_OVERRIDE={cell.model_override}")

    _run(
        [
            "gcloud", "run", "jobs", "update", JOB_NAME,
            f"--project={GCP_PROJECT}",
            f"--region={GCP_REGION}",
            f"--cpu={cell.vcpu}",
            f"--memory={cell.memory_gib}Gi",
        ]
    )
    cmd = [
        "gcloud", "run", "jobs", "execute", JOB_NAME,
        f"--project={GCP_PROJECT}",
        f"--region={GCP_REGION}",
        f"--wait",
        "--update-env-vars", ",".join(env_pairs),
    ]
    proc = _run(cmd, check=False)
    return run_id, proc.returncode, proc.stderr.strip()[-400:]


def _result_fields() -> list[str]:
    return list(summarize_row({}).keys()) + ["cell_key", "status", "gcloud_rc", "error"]


def append_result_row(row: dict[str, Any]) -> None:
    write_header = not _RESULTS_CSV.exists()
    with _RESULTS_CSV.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=_result_fields(), restval="", extrasaction="ignore")
        if write_header:
            writer.writeheader()
        writer.writerow(row)
    with _RESULTS_JSONL.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, default=str) + "\n")


def summarize_row(result: dict[str, Any]) -> dict[str, Any]:
    """Metrics and counts only: no page text, no entity values."""
    m = result.get("metrics") or {}
    stages = m.get("stage_ms") or {}
    row: dict[str, Any] = {
        "run_id": result.get("run_id"),
        "query_id": result.get("query_id"),
        "depth": result.get("depth"),
        "variant": result.get("variant"),
        "vcpu": m.get("vcpu"),
        "memory_gib": m.get("memory_gib"),
        "model_used": result.get("model_used"),
        "duration_ms": m.get("duration_ms"),
        "tor_bootstrap_ms": m.get("tor_bootstrap_ms"),
        "pages_count": m.get("pages_count"),
        "bytes_fetched": m.get("bytes_fetched"),
        "entities_total": sum((m.get("entities_by_type") or {}).values()),
        "relationships_total": sum((m.get("relationships_by_type") or {}).values()),
        "actors_count": m.get("actors_count"),
        "llm_calls": m.get("llm_calls_recorded") if m.get("llm_calls_recorded") is not None else m.get("llm_calls_from_steps"),
        "prompt_tokens": m.get("prompt_tokens"),
        "completion_tokens": m.get("completion_tokens"),
        "llm_cost_measured_delta_usd": m.get("llm_cost_measured_delta_usd"),
        "llm_cost_usd": m.get("llm_cost_usd"),
        "compute_cost_usd": m.get("compute_cost_usd"),
        "total_cost_usd": m.get("total_cost_usd"),
        "refusal_detected": m.get("refusal_detected"),
        "refusal_flags": ";".join(m.get("refusal_flags") or []),
        "exit_code": m.get("exit_code"),
        "run_status": m.get("status"),
        "entities_by_type": json.dumps(m.get("entities_by_type") or {}, sort_keys=True),
        "relationships_by_type": json.dumps(m.get("relationships_by_type") or {}, sort_keys=True),
    }
    for name in STAGE_COLUMNS:
        row[f"stage_{name}_ms"] = stages.get(name)
    return row


STAGE_COLUMNS = (
    "query_refinement", "source_gathering", "scraping", "entity_extraction",
    "enrichment", "graph_build", "summary_generation", "finalization",
)


def resummarize() -> None:
    """Rewrite results.csv/jsonl from the result.json of every recorded run."""
    state = load_state()
    _RESULTS_CSV.unlink(missing_ok=True)
    _RESULTS_JSONL.unlink(missing_ok=True)
    for group in ("completed", "failed"):
        for key, info in (state.get(group) or {}).items():
            run_id = info if isinstance(info, str) else info.get("run_id")
            result = download_result(run_id) if run_id else None
            if result:
                row = summarize_row(result)
                row["cell_key"] = key
                row["status"] = group
                append_result_row(row)


def _select_cells(args: argparse.Namespace) -> list[Cell]:
    cells = [c for c in iter_matrix_cells()
             if (not args.variants or c.variant in args.variants)
             and (not args.depths or c.depth in args.depths)
             and (not args.queries or c.query_id in args.queries)]
    return cells[: args.max_cells] if args.max_cells else cells


def main() -> None:
    parser = argparse.ArgumentParser(prog="baseline.matrix")
    parser.add_argument("--variants", nargs="*", help="default vcpu_compare bypass_compare flash_compare")
    parser.add_argument("--depths", nargs="*", help="quick standard deep")
    parser.add_argument("--queries", nargs="*", help="query ids, e.g. q01 q02")
    parser.add_argument("--max-cells", type=int, default=0, help="stop after N cells this invocation")
    parser.add_argument("--resummarize", action="store_true", help="rebuild results.* from GCS and exit")
    args = parser.parse_args()
    if args.resummarize:
        resummarize()
        return

    engine_sha = os.environ.get("ENGINE_GIT_SHA", "").strip()
    if not engine_sha:
        print("ENGINE_GIT_SHA required", file=sys.stderr)
        sys.exit(2)
    image = (
        f"us-central1-docker.pkg.dev/{GCP_PROJECT}/{ARTIFACT_REPO}/"
        f"{IMAGE_NAME}:{engine_sha}"
    )
    rates = fetch_cloud_run_rates()
    api_key = read_openrouter_key()
    deploy_job(image)

    if provisioning_secret_available():
        print("provisioning key present: per-run keys not wired in E0; using shared-key delta")

    state = load_state()
    executions = int(state.get("executions") or 0)
    ran = 0

    for cell in _select_cells(args):
        if cell.key in state.get("completed", {}):
            continue
        if args.max_cells and ran >= args.max_cells:
            break
        if executions >= MAX_MATRIX_JOB_EXECUTIONS:
            print("job execution cap reached", file=sys.stderr)
            break

        usage = fetch_key_usage(api_key)
        if usage.usage_usd >= MAX_OPENROUTER_USD:
            print(f"OpenRouter spend cap reached (${usage.usage_usd:.2f})", file=sys.stderr)
            break
        if usage.limit_remaining is not None and usage.limit_remaining < MIN_LIMIT_REMAINING_USD:
            print("OpenRouter limit_remaining too low", file=sys.stderr)
            break
        if usage.usage_usd >= OPENROUTER_HARD_KEY_LIMIT_USD - MIN_LIMIT_REMAINING_USD:
            print("OpenRouter hard key limit near", file=sys.stderr)
            break

        run_id, rc, err_tail = execute_cell(cell, rates)
        executions += 1
        ran += 1
        state["executions"] = executions
        time.sleep(GCS_RESULT_VISIBILITY_WAIT_S)
        result = download_result(run_id)
        if result:
            row = summarize_row(result)
            row["cell_key"] = cell.key
            row["status"] = "completed" if rc == 0 and row.get("exit_code") in (0, None) else "failed"
            append_result_row(row)
            if rc == 0 and (row.get("exit_code") in (0, None)):
                state.setdefault("completed", {})[cell.key] = run_id
            else:
                state.setdefault("failed", {})[cell.key] = {"run_id": run_id, "rc": rc}
            print(f"{'ok' if rc == 0 else 'nonzero'} {cell.key} -> {run_id}")
        else:
            append_result_row({"run_id": run_id, "cell_key": cell.key, "query_id": cell.query_id,
                               "depth": cell.depth, "variant": cell.variant, "status": "failed",
                               "gcloud_rc": rc, "error": err_tail or "no result.json"})
            state.setdefault("failed", {})[cell.key] = {"run_id": run_id, "rc": rc, "error": err_tail}
            print(f"fail {cell.key}: {err_tail[-200:]}", file=sys.stderr)
        save_state(state)

    usage = fetch_key_usage(api_key)
    print(f"executions={executions}/{MAX_MATRIX_JOB_EXECUTIONS} openrouter_usage=${usage.usage_usd:.4f}")
    print(f"rows in {_RESULTS_CSV}")


if __name__ == "__main__":
    main()
