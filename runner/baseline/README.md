# E0 baseline harness

Measures what a VoidAccess investigation costs and produces when it runs the way the cloud will run it: one investigation per Cloud Run Job execution, Tor client inside the container, DeepSeek through OpenRouter. The engine source is **not modified**; behaviour is set through env vars, CLI-config values and one in-process wrapper (see "What the harness patches").

Results and conclusions: [docs/baseline/E0-REPORT.md](../../docs/baseline/E0-REPORT.md).

## Prerequisites

- `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess` always (impersonates `va-agent`; never touch the default gcloud config).
- Engine repo `../voidaccess` on `main`, clean tree.
- Python 3.11 venv with the engine plus `requirements-driver.txt` for the local driver.
- The driver reads `openrouter-api-key` from Secret Manager into memory for spend guards. It is never printed or written.

## Build the image

```bash
CTX=$(mktemp -d)
bash runner/baseline/scripts/prepare_build_context.sh "$CTX"   # git archive main, drops tests/, scans for .env and keys
SHA=$(cat "$CTX/engine/ENGINE_GIT_SHA.txt")
cd "$CTX" && CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess gcloud builds submit . \
  --project=voidaccess-cloud --region=us-central1 \
  --config=runner/baseline/cloudbuild.yaml --substitutions=_ENGINE_GIT_SHA=$SHA
```

Image: `us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/engine-baseline:<engine commit sha>`. The prepare script prints the exclusion check and fails on any `.env`, `*.db`, `.git`, `chroma_db`, `__pycache__` or key-shaped string in the staged engine.

The engine's `pyproject.toml` omits 13 top-level packages (`shared_corpus`, `trust_gate`, `netpool`, ...). The image therefore installs dependencies with pip and puts the full staged tree first on `PYTHONPATH`.

## Run one investigation

`run_one` reads `QUERY_ID`, `DEPTH` (`quick|standard|deep`) and optional `RUN_ID`, `RUN_VARIANT`, `SAFETY_BYPASS`, `MODEL_OVERRIDE`, `MEASURE_LLM_COST`, `BASELINE_VCPU`, `BASELINE_MEMORY_GIB` from the environment. The query text is looked up in the baked `queries.yaml`, never passed as an argument. It writes `result.json` to `gs://voidaccess-cloud-runs/baseline/<run_id>/`, even when the investigation fails.

Easiest path is the matrix driver with filters:

```bash
export ENGINE_GIT_SHA=$(git -C ../voidaccess rev-parse main)
cd platform/runner
PYTHONPATH=. python -m baseline.matrix --depths quick --queries q01 --max-cells 1
```

## Run the parallel wave (what E0 actually used)

```bash
PYTHONPATH=. python -m baseline.wave
```

Launches every remaining cell as Cloud Run Job tasks: one execution at 1 vCPU / 2 GiB (parallelism 50) and one at 2 vCPU / 4 GiB, because CPU and memory are per execution. Cells reach the tasks as a base64 `WAVE_CELLS` env var (the runner service account cannot read the bucket). LLM cost comes from recorded tokens priced at the live OpenRouter list price; the driver cross-checks the wave total against the shared key's usage delta and polls spend every 2 minutes, cancelling at $9. Per-cell limits (30 min quick/standard, 40 min deep) are enforced inside the entrypoint and recorded as `timeout`.

Known limits: starting 50 Tor clients at once failed bootstrap in about 3% of tasks, and list-price token estimates ran about 25% above the billed amount.

## Run the matrix (sequential, original method)

```bash
PYTHONPATH=. python -m baseline.matrix                       # everything, resumable
PYTHONPATH=. python -m baseline.matrix --variants flash_compare
PYTHONPATH=. python -m baseline.matrix --resummarize         # rebuild results.* from GCS
```

- Creates/updates Cloud Run Job `engine-baseline`, then runs cells **one at a time** (LLM cost is the delta of `GET /api/v1/key` usage on the shared key).
- Order: quick, standard, deep for all 30 queries, then the comparison variants (`vcpu_compare` 2 vCPU/4 GiB, `bypass_compare` prompt left in, `flash_compare` DeepSeek V4.1 Flash), each on the first 8 queries.
- Every execution counts against the 120 cap, including failures. Spend stops at $9 of usage or when the key has under $0.50 left.
- `matrix_state.json` records completed and failed cells; re-running skips completed ones.
- Outputs `results.csv` and `results.jsonl` (metrics and entity counts only; raw CLI JSON stays in the bucket).

Delete the job when finished: `gcloud run jobs delete engine-baseline --region=us-central1 --project=voidaccess-cloud`.

## What the harness patches

| Item | Mechanism | Why |
|---|---|---|
| Safety-bypass prompt | `VOIDACCESS_SAFETY_BYPASS_PROMPT=off` (engine switch), verified by rendering all six prompt paths | G5 |
| LLM page cap | wraps `extractor.pipeline.extract_entities_from_pages` to pass `max_llm_pages` from `MAX_LLM_PAGES_PER_INV` | the CLI never passes it, so the env var is ignored on the CLI path |
| Progress observation | wraps `InvestigationDisplay.update_step` | roadmap item #6 proof |

## Depth presets

See `presets.yaml`; applied by `policy.apply_depth_preset()` before the engine is imported.

## Cloud policy

`policy.apply_cloud_policy_base()`: `VOIDACCESS_PRIVATE_MODE=1`, no Meilisearch, Chroma path pointed at a throwaway dir, Playwright off, content safety on. Tor runs client-only (`SocksPort` and `DataDirectory`, no relay or exit options). Enrichment keys are not configured, so enrichment runs keyless.

## R0 handoff

Reuse the image, the entrypoint `python -m baseline.run_one`, the env contract above and `presets.yaml`.


## E1B additions

Results: [docs/baseline/E1B-REPORT.md](../../docs/baseline/E1B-REPORT.md).

- **Build from a branch:** `ENGINE_REF=e1b-speed-hook bash runner/baseline/scripts/prepare_build_context.sh "$CTX"` (default `main`). The image tag is the ref's commit sha.
- **Variants:** `variants.yaml` (A speed profile, B + cloud allowlist, C = B at 1 vCPU / 1 GiB, A2/B2 the relaxed confirmation profile). Variant env is applied by `policy.apply_variant_env()` **at image build time**: editing the file requires a rebuild.
- **Wave driver:** `ENGINE_GIT_SHA=<sha> python -m baseline.wave_e1b [--variants A B C] [--pilot N]`. Spend cap `E1B_MAX_USD` (default 5), start guard `E1B_MIN_REMAINING_USD`. Tasks start after a random 0-60 s stagger (`STAGGER_MAX_S`) and Tor bootstraps with one retry. The driver's status poll can go stale after the execution completes; if so, stop it and collect with `baseline.e1b_collect_dir` from downloaded `result.json` files (a threaded client downloads 160 files in minutes; per-file `gcloud` calls are far slower).
- **Probe:** `baseline.probe_job` runs the engine health probe over Tor in a Cloud Run Job (`--command=python --args=-m,baseline.probe_job`).
- **Progress:** per-stage timings come from the engine's `CallbackSink` (`progress_hook.StageCapture`), not from wrapping the Rich display. The page-cap wrapper is gone (the CLI honours `MAX_LLM_PAGES_PER_INV`).
- **Report tables:** `python -m baseline.e1b_report [results_file]`.
