#!/usr/bin/env bash
# Ensure .harness/ is gitignored whenever a file inside it is written or edited.
# PostToolUse — Write|Edit. Exits 0 always.

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // ""')
[[ "$tool" != "Write" && "$tool" != "Edit" ]] && exit 0

file=$(echo "$input" | jq -r '.tool_input.file_path // ""')
echo "$file" | grep -q '\.harness/' || exit 0

# Resolve the worktree/repo root that owns this file. Ask git rather than walking
# up for a .git directory: in a linked worktree .git is a file, not a directory,
# and the file may be written from a subdirectory.
dir=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)
[ -z "$dir" ] && dir=$(pwd)

gitignore="$dir/.gitignore"

if ! grep -qxF '.harness/' "$gitignore" 2>/dev/null; then
  echo '.harness/' >> "$gitignore"
  echo "Added .harness/ to $gitignore" >&2
fi

exit 0
