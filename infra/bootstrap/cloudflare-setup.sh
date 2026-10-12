#!/usr/bin/env bash
# Run yourself (stores secrets):  bash /Users/delzyn/Brand/companies/voidaccess/platform/infra/bootstrap/cloudflare-setup.sh
# Uses the cloudflare-api-token secret to:
#   1. store the account id as cloudflare-account-id
#   2. create (or reuse) the Turnstile widget "voidaccess-waitlist" for voidaccess.pro, www.voidaccess.pro
#   3. store its keys as turnstile-site-key (public) and turnstile-secret-key
# Never prints the secret key. Safe to re-run.
set -euo pipefail
export CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess
CF="$(gcloud secrets versions access latest --secret=cloudflare-api-token)"
api() { curl -sf -H "Authorization: Bearer $CF" -H "Content-Type: application/json" "$@"; }
store() { # name, value via stdin
  gcloud secrets describe "$1" >/dev/null 2>&1 || gcloud secrets create "$1" --replication-policy=automatic >/dev/null
  gcloud secrets versions add "$1" --data-file=- >/dev/null
  echo "stored $1"
}
ACC="$(api https://api.cloudflare.com/client/v4/accounts | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"][0]["id"])')"
printf '%s' "$ACC" | store cloudflare-account-id

W="https://api.cloudflare.com/client/v4/accounts/$ACC/challenges/widgets"
SITEKEY="$(api "$W" | python3 -c 'import sys,json;r=[w for w in json.load(sys.stdin)["result"] if w["name"]=="voidaccess-waitlist"];print(r[0]["sitekey"] if r else "")')"
if [ -z "$SITEKEY" ]; then
  RES="$(api -X POST "$W" -d '{"name":"voidaccess-waitlist","domains":["voidaccess.pro","www.voidaccess.pro"],"mode":"managed"}')"
else
  RES="$(api -X POST "$W/$SITEKEY/rotate_secret" -d '{"invalidate_immediately":true}')"
fi
printf '%s' "$RES" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["sitekey"],end="")' | store turnstile-site-key
printf '%s' "$RES" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["secret"],end="")' | store turnstile-secret-key
echo "done: Turnstile widget voidaccess-waitlist ready"
