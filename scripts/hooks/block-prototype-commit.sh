#!/usr/bin/env bash
# Block commits that stage prototype or spike files.
# PreToolUse — Bash (git commit). Exits 2 to block; 0 to allow.

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // ""')
[ "$tool" != "Bash" ] && exit 0

cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
echo "$cmd" | grep -qE '\bgit\s+commit\b' || exit 0

# List staged files
staged=$(git diff --cached --name-only 2>/dev/null)
[ -z "$staged" ] && exit 0

# Match prototype or spike paths
matches=$(echo "$staged" | grep -E '(^|/)_prototype-|(^|/)_spike/')
[ -z "$matches" ] && exit 0

echo "Blocked: staged files include prototype/spike code:" >&2
echo "$matches" >&2
echo "" >&2
echo "Prototype code should not be committed. Options:" >&2
echo "  • Delete the files and unstage them" >&2
echo "  • Add the path pattern to .gitignore" >&2
echo "  • Move reusable pieces out of _prototype-*/_spike/ first" >&2
exit 2
