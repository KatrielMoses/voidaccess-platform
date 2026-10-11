#!/usr/bin/env bash
# One-time GCP bootstrap for VoidAccess Cloud. Run it yourself (it grants IAM roles).
#
#   bash platform/infra/bootstrap/gcp-bootstrap.sh <BILLING_ACCOUNT_ID> [budget_usd]
#
# Safe to re-run. Uses the dedicated gcloud configuration "voidaccess" and never
# touches the default (optestra) configuration.
#
# Already done (2026-10-11): project voidaccess-cloud, configuration "voidaccess",
# service accounts va-agent / va-runner / va-app.
set -euo pipefail

BILLING="${1:?usage: gcp-bootstrap.sh <BILLING_ACCOUNT_ID> [budget_usd]}"
BUDGET_USD="${2:-25}"
export CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess
P=voidaccess-cloud
REGION=us-central1
ME=katriel.moses@gmail.com
AGENT=va-agent@$P.iam.gserviceaccount.com
RUNNER=va-runner@$P.iam.gserviceaccount.com
APP=va-app@$P.iam.gserviceaccount.com

step() { printf '\n== %s\n' "$*"; }
bind() { gcloud projects add-iam-policy-binding "$P" --member="$1" --role="$2" --condition=None --quiet >/dev/null && echo "  ok $2 → $1"; }

step "1. Link billing account $BILLING"
gcloud billing projects link "$P" --billing-account="$BILLING"

step "2. Enable APIs"
gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com cloudkms.googleapis.com \
  storage.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com billingbudgets.googleapis.com

step "3. Roles for va-agent (what AI agents act as; deploy + operate, cannot edit IAM)"
for R in run.admin artifactregistry.admin cloudbuild.builds.editor storage.admin \
         secretmanager.admin cloudscheduler.admin iam.serviceAccountUser \
         logging.viewer monitoring.viewer cloudkms.admin serviceusage.serviceUsageAdmin; do
  bind "serviceAccount:$AGENT" "roles/$R"
done

step "4. Let you impersonate va-agent (agents use your login, scoped to va-agent's roles)"
gcloud iam service-accounts add-iam-policy-binding "$AGENT" \
  --member="user:$ME" --role=roles/iam.serviceAccountTokenCreator --quiet >/dev/null && echo "  ok"

step "5. Runtime identities (least privilege; bucket/secret/key-level grants are added by P0 Terraform)"
bind "serviceAccount:$RUNNER" roles/logging.logWriter
bind "serviceAccount:$APP"    roles/logging.logWriter
bind "serviceAccount:$APP"    roles/run.developer   # launch/cancel investigation job executions

step "6. Artifact Registry"
gcloud artifacts repositories describe voidaccess --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create voidaccess --repository-format=docker --location="$REGION" \
    --description="VoidAccess runner and app images"

step "7. Buckets"
# Archive: permanent, versioned, soft-delete 90d. No retention lock yet (irreversible; decide later).
gcloud storage buckets describe "gs://$P-archive" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$P-archive" --location="$REGION" --uniform-bucket-level-access \
    --public-access-prevention --soft-delete-duration=90d
gcloud storage buckets update "gs://$P-archive" --versioning
# Run artifacts: transient, auto-deleted after 7 days (the platform ingests them first).
gcloud storage buckets describe "gs://$P-runs" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$P-runs" --location="$REGION" --uniform-bucket-level-access \
    --public-access-prevention
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}' > /tmp/va-runs-lifecycle.json
gcloud storage buckets update "gs://$P-runs" --lifecycle-file=/tmp/va-runs-lifecycle.json

step "8. KMS key for credential encryption at rest"
gcloud kms keyrings describe voidaccess --location="$REGION" >/dev/null 2>&1 || \
  gcloud kms keyrings create voidaccess --location="$REGION"
gcloud kms keys describe credentials --keyring=voidaccess --location="$REGION" >/dev/null 2>&1 || \
  gcloud kms keys create credentials --keyring=voidaccess --location="$REGION" \
    --purpose=encryption --rotation-period=90d --next-rotation-time="$(date -u -v+90d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)"

step "9. Secret containers (values are added separately; see README)"
for S in openrouter-api-key openrouter-provisioning-key database-url engine-callback-secret; do
  gcloud secrets describe "$S" >/dev/null 2>&1 || gcloud secrets create "$S" --replication-policy=automatic
done

step "10. Budget alert (50/90/100% of \$$BUDGET_USD per month, email to billing admins)"
gcloud billing budgets list --billing-account="$BILLING" --format='value(displayName)' | grep -qx "voidaccess-cloud monthly" || \
  gcloud billing budgets create --billing-account="$BILLING" --display-name="voidaccess-cloud monthly" \
    --budget-amount="${BUDGET_USD}USD" --filter-projects="projects/$P" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0

step "11. Make the voidaccess configuration act as va-agent"
gcloud config set auth/impersonate_service_account "$AGENT" --configuration=voidaccess

step "Done. Verify with:"
echo "  CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess gcloud run jobs list --region=$REGION"
