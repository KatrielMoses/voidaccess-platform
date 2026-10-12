#!/usr/bin/env bash
# Deploys apps/site to Cloudflare Workers via OpenNext. Secrets are read from GCP Secret Manager at
# deploy time into this process's environment only; nothing is printed or written to disk.
#   CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess pnpm --filter site deploy
# If ANY required secret has no enabled version, nothing is deployed and the missing ones are listed.
set -euo pipefail
cd "$(dirname "$0")/.."
export CLOUDSDK_ACTIVE_CONFIG_NAME="${CLOUDSDK_ACTIVE_CONFIG_NAME:-voidaccess}"

# secret-manager name : env var
REQUIRED=(
  "cloudflare-api-token:CLOUDFLARE_API_TOKEN"
  "cloudflare-account-id:CLOUDFLARE_ACCOUNT_ID"
  "database-url:DATABASE_URL"
  "resend-api-key:RESEND_API_KEY"
  "turnstile-secret-key:TURNSTILE_SECRET_KEY"
)

missing=()
for pair in "${REQUIRED[@]}"; do
  name="${pair%%:*}"; var="${pair##*:}"
  if val="$(gcloud secrets versions access latest --secret="$name" 2>/dev/null)" && [ -n "$val" ]; then
    export "$var=$val"
  else
    missing+=("$name")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "NOT DEPLOYING. Missing secrets (no enabled version): ${missing[*]}" >&2
  echo "Local alternatives: 'pnpm --filter site cf:preview' (wrangler dev on :8788) or 'pnpm --filter site build'." >&2
  exit 2
fi

# IP-hash salt: created once, then reused (rotating it only resets abuse counters).
if ! IP_HASH_SALT="$(gcloud secrets versions access latest --secret=waitlist-ip-salt 2>/dev/null)" || [ -z "$IP_HASH_SALT" ]; then
  gcloud secrets describe waitlist-ip-salt >/dev/null 2>&1 || gcloud secrets create waitlist-ip-salt --replication-policy=automatic >/dev/null
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add waitlist-ip-salt --data-file=- >/dev/null
  IP_HASH_SALT="$(gcloud secrets versions access latest --secret=waitlist-ip-salt)"
fi
export IP_HASH_SALT

pnpm exec opennextjs-cloudflare build
for var in DATABASE_URL RESEND_API_KEY TURNSTILE_SECRET_KEY IP_HASH_SALT; do
  printf '%s' "${!var}" | pnpm exec wrangler secret put "$var" >/dev/null
done
pnpm exec opennextjs-cloudflare deploy
