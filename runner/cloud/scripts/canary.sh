#!/usr/bin/env bash
# Canary for a runner image: run its engine directly (no app, no callbacks, no uploads, no user data) on two fixed
# queries and print one summary line per run (runner/cloud/canary.py).
#
# Usage: runner/cloud/scripts/canary.sh <image-tag> [rounds]      e.g. canary.sh c66b9a0-1a2b3c4 2
#   CANARY_JOB   job name (default va-runner-canary). Use a second name to run two images side by side, e.g.
#                CANARY_JOB=va-runner-canary-base canary.sh bf2213c-95be6a1 2
# Each round starts "LockBit ransomware" (quick) and "RedLine stealer infostealer logs" (standard) in parallel.
# The job mirrors va-runner (infra/terraform/modules/runner): service account va-runner, 1 vCPU / 2 GiB, 900 s task
# timeout, no retries, default egress, only the OpenRouter key from Secret Manager. canary.py is sent base64-encoded
# through `python -c`, so the same measurement runs inside images built before it existed.
# Read the results (one CANARY line per run):
#   gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="<job>" AND textPayload:"CANARY "' \
#     --freshness=2h --format='value(textPayload)'
set -euo pipefail

TAG="${1:?usage: canary.sh <image-tag> [rounds]}"
ROUNDS="${2:-2}"
JOB="${CANARY_JOB:-va-runner-canary}"
PROJECT="${PROJECT:-voidaccess-cloud}"
REGION="${REGION:-us-central1}"
IMAGE="us-central1-docker.pkg.dev/$PROJECT/voidaccess/runner:$TAG"
HERE="$(cd "$(dirname "$0")" && pwd)"
B64="$(base64 < "$HERE/../canary.py" | tr -d '\n')"
LOADER='import base64;import sys;exec(base64.b64decode(sys.argv[1]))'  # no commas: gcloud splits --args on them

gcloud run jobs deploy "$JOB" --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --service-account "va-runner@$PROJECT.iam.gserviceaccount.com" \
  --cpu 1 --memory 2Gi --task-timeout 900s --max-retries 0 --tasks 1 \
  --set-secrets OPENROUTER_API_KEY=openrouter-api-key:latest \
  --command python --labels purpose=canary --quiet

for round in $(seq 1 "$ROUNDS"); do
  for spec in "lockbit-quick|LockBit ransomware|quick" "redline-standard|RedLine stealer infostealer logs|standard"; do
    IFS='|' read -r label query depth <<<"$spec"
    gcloud run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --async \
      --args="-c,$LOADER,$B64,$label-r$round,$query,$depth" --format='value(metadata.name)'
  done
done
