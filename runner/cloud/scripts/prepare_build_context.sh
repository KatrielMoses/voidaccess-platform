#!/usr/bin/env bash
# Stage the Cloud Build context for the production runner image:
#   engine/  = `git archive` of the pinned public engine commit (never a working tree)
#   runner/cloud/ = this directory without tests, caches or vectors
# Usage: prepare_build_context.sh [OUT_DIR]   (prints ENGINE_SHA, RUNNER_SHA and TAG as KEY=VALUE lines at the end)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLATFORM_REPO="${PLATFORM_REPO:-$(cd "$HERE/../../.." && pwd)}"
ENGINE_REPO="${ENGINE_REPO:-$(cd "$PLATFORM_REPO/../../.." 2>/dev/null && cd voidaccess 2>/dev/null && pwd || echo "")}"
ENGINE_REF="${ENGINE_REF:-v2.1.1}"
# The commit a tag ref must resolve to (a moved or re-created tag stops the build). A commit ref is checked against itself.
ENGINE_EXPECT="${ENGINE_EXPECT:-1d85bb1}"
OUT="${1:-$(mktemp -d)}"

if [[ -z "$ENGINE_REPO" || ! -d "$ENGINE_REPO/.git" ]]; then
  echo "FATAL: set ENGINE_REPO to the engine checkout" >&2; exit 1
fi
ENGINE_SHA="$(git -C "$ENGINE_REPO" rev-parse --short=7 "$ENGINE_REF^{commit}")"
if [[ "$ENGINE_REF" =~ ^[0-9a-f]{7,40}$ ]]; then
  ENGINE_EXPECT="$ENGINE_REF"
fi
if [[ "$ENGINE_SHA" != "${ENGINE_EXPECT:0:7}" ]]; then
  echo "FATAL: ENGINE_REF $ENGINE_REF resolved to $ENGINE_SHA, expected ${ENGINE_EXPECT:0:7}" >&2; exit 1
fi
ENGINE_VERSION="$(git -C "$ENGINE_REPO" show "$ENGINE_SHA:pyproject.toml" | sed -n 's/^version = "\(.*\)"$/\1/p')"
if [[ -n "$(git -C "$PLATFORM_REPO" status --porcelain -- runner/cloud packages/engine-client/schemas)" ]]; then
  echo "FATAL: runner/cloud has uncommitted changes; commit first so the image tag names real code" >&2; exit 1
fi
RUNNER_SHA="$(git -C "$PLATFORM_REPO" rev-parse --short=7 HEAD)"

rm -rf "$OUT" && mkdir -p "$OUT/engine" "$OUT/runner"
git -C "$ENGINE_REPO" archive "$ENGINE_SHA" | tar -x -C "$OUT/engine"
echo "$ENGINE_SHA" > "$OUT/engine/ENGINE_GIT_SHA.txt"
# The engine's tests/ is not needed at runtime and tests/test_setup.sh contains a key-shaped string (E0 deviation 6).
rm -rf "$OUT/engine/tests"

rsync -a --exclude '__pycache__' --exclude 'tests' --exclude '.pytest_cache' --exclude '*.pyc' \
  "$PLATFORM_REPO/runner/cloud/" "$OUT/runner/cloud/"

# Hygiene: nothing secret-shaped may enter the context (cloudbuild.yaml checks again, and checks the image).
if find "$OUT" \( -name '.env' -o \( -name '.env.*' ! -name '.env.example' \) -o -name '*.db' \) | grep -q .; then
  echo "FATAL: .env or *.db in the staged context" >&2; exit 1
fi
if find "$OUT" -type d \( -name .git -o -name chroma_db -o -name __pycache__ \) | grep -q .; then
  echo "FATAL: .git / chroma_db / __pycache__ in the staged context" >&2; exit 1
fi
if grep -rIlE 'sk-or-v1-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}' "$OUT" | grep .; then
  echo "FATAL: key-shaped string in the staged context (files listed above)" >&2; exit 1
fi
echo "Context check: no .env, *.db, .git, chroma_db, __pycache__ or key-shaped strings"
echo "Prepared context at $OUT"
echo "ENGINE_SHA=$ENGINE_SHA"
echo "ENGINE_VERSION=$ENGINE_VERSION"
echo "RUNNER_SHA=$RUNNER_SHA"
echo "TAG=$ENGINE_SHA-$RUNNER_SHA"
