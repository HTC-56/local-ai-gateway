#!/usr/bin/env bash
# readme-lint.sh — the commands the README tells a stranger to run must exist.
#
# Scans fenced code blocks in README.md and checks that:
#   - every `pnpm <name>` / `pnpm run <name>` names a script in package.json
#   - every `bash <path>` / `node <path>` / `./<path>` points at a real file
# Everything else (curl, systemctl, cp, ollama, ...) is ignored.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

README="README.md"
if [ ! -f "$README" ]; then
  echo "readme-lint: FAIL — $README does not exist"
  exit 1
fi

failures=0
fail() { echo "readme-lint: FAIL — $1"; failures=$((failures + 1)); }

in_block=0
checked=0

while IFS= read -r line; do
  case "$line" in
    '```'*) in_block=$((1 - in_block)); continue ;;
  esac
  [ "$in_block" -eq 1 ] || continue

  # Strip a leading shell prompt and surrounding whitespace.
  cmd="${line#"${line%%[![:space:]]*}"}"
  cmd="${cmd#\$ }"

  read -r -a words <<< "$cmd"
  [ "${#words[@]}" -gt 0 ] || continue

  case "${words[0]}" in
    pnpm)
      sub="${words[1]:-}"
      [ "$sub" = "run" ] && sub="${words[2]:-}"
      case "$sub" in
        ''|install|i|add|remove|dlx|exec|why|list|-*) continue ;;
      esac
      checked=$((checked + 1))
      grep -qE "\"$sub\"[[:space:]]*:" package.json \
        || fail "README runs 'pnpm $sub' but package.json has no \"$sub\" script"
      ;;
    bash|sh|node)
      target="${words[1]:-}"
      case "$target" in ''|-*) continue ;; esac
      checked=$((checked + 1))
      [ -e "$target" ] || fail "README runs '${words[0]} $target' but $target does not exist"
      ;;
    ./*)
      target="${words[0]}"
      checked=$((checked + 1))
      [ -e "$target" ] || fail "README runs '$target' but that file does not exist"
      ;;
  esac
done < "$README"

if [ "$failures" -gt 0 ]; then
  echo "readme-lint: $failures problem(s)"
  exit 1
fi

echo "readme-lint: clean ($checked command(s) checked)"
