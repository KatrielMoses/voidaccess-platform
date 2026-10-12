#!/usr/bin/env bash
# Deploys apps/site to Cloudflare Workers via OpenNext. Secrets are read from GCP Secret Manager at
# deploy time into this process's environment only; nothing is printed or written to disk.
#   CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess pnpm --filter site deploy                 # minimal site (default)
#   SITE_MODE=full CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess pnpm --filter site deploy  # marketing site + waitlist
# If ANY required secret has no enabled version, nothing is deployed and the missing ones are listed.
#
# minimal: auth + legal pages + placeholder home (wrangler.jsonc). Needs no database, Resend or IP salt, and no
#          Turnstile secret (the app verifies Turnstile). Turnstile's SITE key is public but must be inlined at build time.
# full:    also needs DATABASE_URL, RESEND_API_KEY, TURNSTILE_SECRET_KEY, IP_HASH_SALT (wrangler.full.jsonc).
set -euo pipefail
cd "$(dirname "$0")/.."
export CLOUDSDK_ACTIVE_CONFIG_NAME="${CLOUDSDK_ACTIVE_CONFIG_NAME:-voidaccess}"

SITE_MODE="${SITE_MODE:-minimal}"
case "$SITE_MODE" in
  minimal) WRANGLER_CONFIG=wrangler.jsonc ;;
  full) WRANGLER_CONFIG=wrangler.full.jsonc ;;
  *) echo "SITE_MODE must be 'minimal' or 'full' (got '$SITE_MODE')" >&2; exit 2 ;;
esac

# secret-manager name : env var
REQUIRED=(
  "cloudflare-api-token:CLOUDFLARE_API_TOKEN"
  "cloudflare-account-id:CLOUDFLARE_ACCOUNT_ID"
  "turnstile-site-key:NEXT_PUBLIC_TURNSTILE_SITE_KEY"
)
if [ "$SITE_MODE" = "full" ]; then
  REQUIRED+=(
    "database-url:DATABASE_URL"
    "resend-api-key:RESEND_API_KEY"
    "turnstile-secret-key:TURNSTILE_SECRET_KEY"
  )
fi

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

if [ "$SITE_MODE" = "full" ]; then
  # IP-hash salt: created once, then reused (rotating it only resets abuse counters).
  if ! IP_HASH_SALT="$(gcloud secrets versions access latest --secret=waitlist-ip-salt 2>/dev/null)" || [ -z "$IP_HASH_SALT" ]; then
    gcloud secrets describe waitlist-ip-salt >/dev/null 2>&1 || gcloud secrets create waitlist-ip-salt --replication-policy=automatic >/dev/null
    openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add waitlist-ip-salt --data-file=- >/dev/null
    IP_HASH_SALT="$(gcloud secrets versions access latest --secret=waitlist-ip-salt)"
  fi
  export IP_HASH_SALT
fi

# Inlined into the static pages at build time (the wrangler vars only exist at runtime).
export SITE_MODE
export SITE_URL="${SITE_URL:-https://voidaccess.pro}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-https://app.voidaccess.pro}"

pnpm exec opennextjs-cloudflare build -c "$WRANGLER_CONFIG"
if [ "$SITE_MODE" = "full" ]; then
  for var in DATABASE_URL RESEND_API_KEY TURNSTILE_SECRET_KEY IP_HASH_SALT; do
    printf '%s' "${!var}" | pnpm exec wrangler secret put "$var" -c "$WRANGLER_CONFIG" >/dev/null
  done
fi
pnpm exec opennextjs-cloudflare deploy -c "$WRANGLER_CONFIG"
