#!/usr/bin/env bash
# scrub-check.sh — public-repo discipline gate (DECISIONS.md).
#
# This repo will be published. Fails if any tracked or newly-added file
# contains a private hostname, a non-documentation IP literal, an absolute
# home path, or key material. Documentation uses `localhost`, `127.0.0.1` and
# the RFC 5737 ranges 192.0.2.x / 198.51.100.x / 203.0.113.x only.
#
# This script excludes itself from the scan (it necessarily contains the
# patterns it looks for). Review it by hand.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

SELF="scripts/scrub-check.sh"
failures=0

mapfile -t FILES < <(git ls-files --cached --others --exclude-standard | grep -v "^${SELF}$")

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "scrub-check: no files to scan"
  exit 0
fi

report() {
  # report <label> <grep-output>
  echo "scrub-check: FAIL — $1"
  printf '%s\n' "$2" | sed 's/^/    /'
  failures=$((failures + 1))
}

scan() {
  # scan <label> <extended-regex>
  local label="$1" pattern="$2" hits
  hits=$(grep -nEI -- "$pattern" "${FILES[@]}" 2>/dev/null)
  [ -n "$hits" ] && report "$label" "$hits"
}

# 1. Absolute home paths.
scan "absolute home path" '(/home/|/Users/)[A-Za-z0-9._-]+'

# 2. Key material.
scan "private key block" '-----BEGIN [A-Z ]*PRIVATE KEY-----'
scan "api key literal"   '\b(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})'

# 3. Private / LAN hostnames.
scan "private hostname suffix" '\.(local|lan|internal|localdomain|home\.arpa)\b'

# 4. IP literals outside the documentation ranges.
ip_hits=$(grep -nEIo '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "${FILES[@]}" 2>/dev/null \
  | grep -vE ':(127\.0\.0\.1|0\.0\.0\.0|255\.255\.255\.255)$' \
  | grep -vE ':(192\.0\.2|198\.51\.100|203\.0\.113)\.[0-9]{1,3}$')
if [ -n "$ip_hits" ]; then
  report "IP literal outside documentation ranges" "$ip_hits"
fi

if [ "$failures" -gt 0 ]; then
  echo "scrub-check: $failures check(s) failed"
  exit 1
fi

echo "scrub-check: clean (${#FILES[@]} files)"
