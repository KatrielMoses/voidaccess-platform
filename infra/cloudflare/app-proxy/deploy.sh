#!/usr/bin/env bash
# Deploys the app.voidaccess.pro fallback proxy. Cloudflare credentials come from Secret Manager into this
# process's environment only; nothing is printed or written to disk.
set -euo pipefail
cd "$(dirname "$0")"
export CLOUDSDK_ACTIVE_CONFIG_NAME="${CLOUDSDK_ACTIVE_CONFIG_NAME:-voidaccess}"
CLOUDFLARE_API_TOKEN="$(gcloud secrets versions access latest --secret=cloudflare-api-token)"
CLOUDFLARE_ACCOUNT_ID="$(gcloud secrets versions access latest --secret=cloudflare-account-id)"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
pnpm --filter site exec wrangler deploy --config "$PWD/wrangler.jsonc"
