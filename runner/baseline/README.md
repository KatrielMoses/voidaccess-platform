# E0 baseline harness

Measures VoidAccess Cloud investigation cost and output quality using the **unchanged** engine CLI inside Cloud Run Jobs (Tor in-container, DeepSeek via OpenRouter).

## Prerequisites

- `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess` (impersonates `va-agent`; never use default gcloud config).
- Engine repo `../voidaccess` on `main` with a **clean** working tree.
- OpenRouter key in Secret Manager (`openrouter-api-key`); local matrix driver needs `OPENROUTER_API_KEY` for spend guards only (never commit).

## Build image

```bash
ENGINE_SHA=$(git -C ../voidaccess rev-parse main)
CTX=$(mktemp -d)
bash runner/baseline/scripts/prepare_build_context.sh "$CTX"
CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess gcloud builds submit "$CTX" \
  --project=voidaccess-cloud \
  --config="$CTX/runner/baseline/cloudbuild.yaml" \
  --substitutions=_ENGINE_GIT_SHA="$ENGINE_SHA"
```

Image: `us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/engine-baseline:$ENGINE_SHA`

The prepare script prints a **no `.env` / no `*.db`** check on the staged engine tree.

## Run one investigation (Cloud Run Job)

Deploy once (matrix does this automatically):

```bash
gcloud run jobs deploy engine-baseline \
  --project=voidaccess-cloud --region=us-central1 \
  --image=us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/engine-baseline:$ENGINE_SHA \
  --service-account=va-runner@voidaccess-cloud.iam.gserviceaccount.com \
  --task-timeout=45m --cpu=1 --memory=2Gi --max-retries=0 \
  --set-secrets=OPENROUTER_API_KEY=openrouter-api-key:latest \
  --command=python --args=-m,baseline.run_one
```

Execute a single quick cell:

```bash
gcloud run jobs execute engine-baseline --project=voidaccess-cloud --region=us-central1 --wait \
  --update-env-vars=QUERY_ID=q01,DEPTH=quick,RUN_ID=$(uuidgen)
```

`result.json` lands at `gs://voidaccess-cloud-runs/baseline/<RUN_ID>/`.

## Run matrix

```bash
export ENGINE_GIT_SHA=$(git -C ../voidaccess rev-parse main)
export OPENROUTER_API_KEY=...   # local guard only; job uses Secret Manager
cd platform/runner
PYTHONPATH=. python -m baseline.matrix
```

Writes `baseline/results.csv`, `baseline/results.jsonl`, and resumable `baseline/matrix_state.json`.

## Report

```bash
PYTHONPATH=platform/runner python -m baseline.report
```

Output: `docs/baseline/E0-REPORT.md` (extend manually for licence table, typed edges, progress hook, refusal comparison).

## Depth presets

See `presets.yaml`. Applied in `policy.apply_depth_preset()` before engine import.

## Cloud policy

`policy.apply_cloud_policy_base()` — private mode, no Meilisearch/Chroma, Playwright off, content safety on, `SAFETY_BYPASS_PROMPT` cleared unless `SAFETY_BYPASS=1`.

## R0 handoff

Reuse this image tag, entrypoint `python -m baseline.run_one`, env contract (`QUERY_ID`, `DEPTH`, `RUN_ID`), and `presets.yaml`.
