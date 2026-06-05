#!/usr/bin/env bash
# Block dangerous git operations that cannot be undone.
# PreToolUse — Bash. Exits 2 to block; 0 to allow.

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // ""')
[ "$tool" != "Bash" ] && exit 0

cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
echo "$cmd" | grep -q '\bgit\b' || exit 0

blocked=""

# git push --force / -f (any position)
echo "$cmd" | grep -qE '\bgit\b.*\bpush\b' && \
  echo "$cmd" | grep -qE '(^|\s)(--force|-f)(\s|$)' && \
  blocked="git push --force"

# git reset --hard
echo "$cmd" | grep -qE '\bgit\s+reset\s+--hard' && blocked="git reset --hard"

# git clean -f (any combo of -f -d -x)
echo "$cmd" | grep -qE '\bgit\s+clean\s+-[fdx]*f[fdx]*(\s|$)' && blocked="git clean -f"

# git branch -D
echo "$cmd" | grep -qE '\bgit\s+branch\s+-D\b' && blocked="git branch -D"

# git checkout . or git checkout -- .
echo "$cmd" | grep -qE '\bgit\s+checkout\s+(\.|--\s)' && blocked="git checkout ."

# git restore . (discards working tree changes)
echo "$cmd" | grep -qE '\bgit\s+restore\s+\.' && blocked="git restore ."

if [ -n "$blocked" ]; then
  echo "Blocked: $blocked — this operation cannot be undone." >&2
  echo "If you're sure, run the command directly in your terminal." >&2
  exit 2
fi

exit 0
