#!/usr/bin/env bash
# Store the value currently on the clipboard as a new version of a Secret Manager secret, then clear the clipboard.
#   copy the key, then:  bash platform/infra/bootstrap/add-secret.sh <secret-name>
# Never echoes the value.
set -euo pipefail
NAME="${1:?usage: add-secret.sh <secret-name>}"
export CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess
VALUE="$(pbpaste)"
[ -n "$VALUE" ] || { echo "clipboard is empty; copy the key first"; exit 1; }
gcloud secrets describe "$NAME" >/dev/null 2>&1 || gcloud secrets create "$NAME" --replication-policy=automatic >/dev/null
printf '%s' "$VALUE" | gcloud secrets versions add "$NAME" --data-file=- >/dev/null
pbcopy </dev/null
echo "stored $NAME (${#VALUE} chars); clipboard cleared"
