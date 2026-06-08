#!/usr/bin/env bash
# Ensure .harness/ is gitignored whenever a file inside it is written or edited.
# PostToolUse — Write|Edit. Exits 0 always.

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // ""')
[[ "$tool" != "Write" && "$tool" != "Edit" ]] && exit 0

file=$(echo "$input" | jq -r '.tool_input.file_path // ""')
echo "$file" | grep -q '\.harness/' || exit 0

# Walk up from the written file to find the repo root
dir=$(dirname "$file")
while [ "$dir" != "/" ]; do
  [ -d "$dir/.git" ] && break
  dir=$(dirname "$dir")
done

[ "$dir" = "/" ] && dir=$(pwd)

gitignore="$dir/.gitignore"

if ! grep -qxF '.harness/' "$gitignore" 2>/dev/null; then
  echo '.harness/' >> "$gitignore"
  echo "Added .harness/ to $gitignore"
fi

exit 0
