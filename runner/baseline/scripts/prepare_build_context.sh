#!/usr/bin/env bash
# Stage Cloud Build context: engine/ from git archive + runner/baseline harness.
set -euo pipefail

ENGINE_REPO="${ENGINE_REPO:-$(cd "$(dirname "$0")/../../../../voidaccess" && pwd)}"
PLATFORM_REPO="${PLATFORM_REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}"
OUT="${1:-$(mktemp -d)}"
# Engine ref to build (default main). E1B builds from the e1b-speed-hook branch.
ENGINE_REF="${ENGINE_REF:-main}"

echo "Engine repo: $ENGINE_REPO"
echo "Output dir: $OUT"

if [[ -n "$(git -C "$ENGINE_REPO" status --short)" ]]; then
  echo "WARNING: voidaccess working tree is not clean — staging committed $ENGINE_REF only via git archive" >&2
fi

ENGINE_SHA="$(git -C "$ENGINE_REPO" rev-parse "$ENGINE_REF")"
mkdir -p "$OUT/engine" "$OUT/runner/baseline"

git -C "$ENGINE_REPO" archive "$ENGINE_REF" | tar -x -C "$OUT/engine"
echo "$ENGINE_SHA" > "$OUT/engine/ENGINE_GIT_SHA.txt"

# The engine's tests/ is not needed at runtime and tests/test_setup.sh contains a
# key-shaped string, so it is dropped from the staged copy (engine tree untouched).
rm -rf "$OUT/engine/tests"

# Verify exclusions (archive excludes untracked; double-check patterns).
if find "$OUT/engine" \( -name '.env' -o -name '.env.*' ! -name '.env.example' \) | grep -q .; then
  echo "FATAL: .env material in staged engine" >&2
  exit 1
fi
if find "$OUT/engine" -name '*.db' | grep -q .; then
  echo "FATAL: *.db in staged engine" >&2
  exit 1
fi
# Key-material scan over the staged engine (excluding the PEM *header* strings in
# yara_export.py, which are detection patterns, not keys).
if grep -rIlE 'sk-or-v1-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}' "$OUT/engine" | grep .; then
  echo "FATAL: key-shaped string in staged engine (files listed above)" >&2
  exit 1
fi
if find "$OUT/engine" -type d \( -name .git -o -name chroma_db -o -name __pycache__ \) | grep -q .; then
  echo "FATAL: .git / chroma_db / __pycache__ in staged engine" >&2
  exit 1
fi
echo "Context check: no .env, *.db, .git, chroma_db, __pycache__ or key-shaped strings in engine/"

rsync -a --exclude '__pycache__' --exclude 'matrix_state.json' --exclude 'results.*' \
  "$PLATFORM_REPO/runner/baseline/" "$OUT/runner/baseline/"

echo "Prepared context at $OUT"
echo "ENGINE_GIT_SHA=$ENGINE_SHA"
