#!/usr/bin/env bash
# IAM grants for VoidAccess Cloud. Run this yourself: it grants roles, which agents must not do.
#   bash platform/infra/bootstrap/gcp-iam.sh
# Safe to re-run. Everything else in gcp-bootstrap.sh is already done (2026-10-11).
set -euo pipefail
export CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess
P=voidaccess-cloud
ME=katriel.moses@gmail.com
AGENT=va-agent@$P.iam.gserviceaccount.com
RUNNER=va-runner@$P.iam.gserviceaccount.com
APP=va-app@$P.iam.gserviceaccount.com
bind() { gcloud projects add-iam-policy-binding "$P" --member="$1" --role="$2" --condition=None --quiet >/dev/null && echo "  ok $2 → ${1#*:}"; }

echo "== va-agent: deploy + operate (cannot edit IAM or billing)"
for R in run.admin artifactregistry.admin cloudbuild.builds.editor storage.admin \
         secretmanager.admin cloudscheduler.admin iam.serviceAccountUser \
         logging.viewer monitoring.viewer cloudkms.admin serviceusage.serviceUsageAdmin; do
  bind "serviceAccount:$AGENT" "roles/$R"
done

echo "== runtime identities"
bind "serviceAccount:$RUNNER" roles/logging.logWriter
bind "serviceAccount:$APP"    roles/logging.logWriter
bind "serviceAccount:$APP"    roles/run.developer
# The runner reads the OpenRouter keys and writes run artifacts.
for S in openrouter-api-key openrouter-provisioning-key; do
  gcloud secrets add-iam-policy-binding "$S" --member="serviceAccount:$RUNNER" \
    --role=roles/secretmanager.secretAccessor --quiet >/dev/null && echo "  ok secretAccessor $S → runner"
done
gcloud storage buckets add-iam-policy-binding "gs://$P-runs" --member="serviceAccount:$RUNNER" \
  --role=roles/storage.objectCreator --quiet >/dev/null && echo "  ok objectCreator runs bucket → runner"

echo "== let you impersonate va-agent, then make the voidaccess config use it"
gcloud iam service-accounts add-iam-policy-binding "$AGENT" \
  --member="user:$ME" --role=roles/iam.serviceAccountTokenCreator --quiet >/dev/null && echo "  ok tokenCreator"
echo "  (IAM can take ~1 min to propagate)"
gcloud config set auth/impersonate_service_account "$AGENT" --configuration=voidaccess

echo "== verify"
sleep 60
gcloud run jobs list --region=us-central1 && echo "  impersonation works"
