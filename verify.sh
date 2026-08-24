#!/usr/bin/env bash
# verify.sh — the whole gate in one command (SPEC.md gates).
#
#   typecheck + tests + public-repo scrub + README quickstart lint
#
# Every phase ends green here. Runs every step even if an earlier one fails,
# so one run tells you everything that is broken.
set -uo pipefail

cd "$(dirname "$0")" || exit 2

failed=()

step() {
  # step <label> <command...>
  local label="$1"; shift
  echo
  echo "=== $label ==="
  if "$@"; then
    echo "--- $label: OK"
  else
    echo "--- $label: FAILED"
    failed+=("$label")
  fi
}

step "typecheck" pnpm typecheck
step "test"      pnpm test
step "scrub"     bash scripts/scrub-check.sh
step "readme"    bash scripts/readme-lint.sh

echo
if [ "${#failed[@]}" -gt 0 ]; then
  echo "verify: FAILED — ${failed[*]}"
  exit 1
fi
echo "verify: all green"
