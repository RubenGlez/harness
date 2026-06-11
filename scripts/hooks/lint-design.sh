#!/usr/bin/env bash
# Lint DESIGN.md after every Write or Edit to that file.
# PostToolUse — Write, Edit. Exits 0 always (informational).

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // ""')

case "$tool" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

file=$(echo "$input" | jq -r '.tool_input.file_path // ""')
[ "$(basename "$file")" != "DESIGN.md" ] && exit 0
[ ! -f "$file" ] && exit 0

command -v npx &>/dev/null || exit 0

echo "Linting DESIGN.md..." >&2
npx --yes @google/design.md@0.2.0 lint "$file" >&2
exit 0
