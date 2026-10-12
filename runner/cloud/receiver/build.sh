#!/usr/bin/env bash
# Build the temporary receiver image with Cloud Build. Usage: build.sh <tag>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
CTX="$(mktemp -d)"
cp "$HERE"/{package.json,Dockerfile,receiver.ts} "$CTX/"
mkdir -p "$CTX/engine-client" && cp -R "$REPO/packages/engine-client/src" "$REPO/packages/engine-client/schemas" "$CTX/engine-client/"
rm -f "$CTX"/engine-client/src/*.test.ts
gcloud builds submit "$CTX" --tag "us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/va-r0-receiver:${1:-tmp}"
