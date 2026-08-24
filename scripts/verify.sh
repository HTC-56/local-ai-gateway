#!/usr/bin/env bash
# verify.sh — the full gate for every Phase A task.
#
# Runs four steps in order; stops on the first failure.
#   1. TypeScript type check
#   2. Unit tests
#   3. Public-repo scrub (no private hostnames/keys/LAN IPs)
#   4. README lint (every command the README tells a stranger to run must exist)
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

fail() { echo "verify: FAIL — $1"; exit 1; }

echo "verify 1/4: typecheck"
pnpm typecheck || fail "typecheck"
echo "verify 1/4: ok"

echo "verify 2/4: test"
pnpm test || fail "test"
echo "verify 2/4: ok"

echo "verify 3/4: scrub-check"
bash scripts/scrub-check.sh || fail "scrub-check"
echo "verify 3/4: ok"

echo "verify 4/4: readme-lint"
bash scripts/readme-lint.sh || fail "readme-lint"
echo "verify 4/4: ok"

echo "verify: all 4 steps green"
