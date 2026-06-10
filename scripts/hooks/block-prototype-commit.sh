#!/usr/bin/env bash
# Block commits that would include prototype or spike files.
# PreToolUse — Bash (git commit). Exits 2 to block; 0 to allow.
#
# Checks three routes prototype code can reach a commit:
#   1. already staged           (git add earlier, then git commit)
#   2. named on the command line (git add _spike/x && git commit)
#   3. staged implicitly         (git commit -a, or an add in the same command)

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // ""')
[ "$tool" != "Bash" ] && exit 0

cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
echo "$cmd" | grep -qE '\bgit\s+commit\b' || exit 0

PROTO_RE='(^|/)_prototype-|(^|/)_spike/'

block() {
  echo "Blocked: this commit would include prototype/spike code:" >&2
  echo "$1" >&2
  echo "" >&2
  echo "Prototype code should not be committed. Options:" >&2
  echo "  • Delete the files and unstage them" >&2
  echo "  • Add the path pattern to .gitignore" >&2
  echo "  • Move reusable pieces out of _prototype-*/_spike/ first" >&2
  exit 2
}

# 1. Already staged
staged=$(git diff --cached --name-only 2>/dev/null | grep -E "$PROTO_RE")
[ -n "$staged" ] && block "$staged"

# 2. Prototype path named in the command itself
named=$(echo "$cmd" | grep -oE '[^ "'"'"']*(_prototype-|_spike/)[^ "'"'"']*')
[ -n "$named" ] && block "$named"

# 3. Implicit staging: commit -a/-am, or an add in the same command line —
#    files staged after this hook runs, so check the working tree too
if echo "$cmd" | grep -qE '\bgit\s+commit\s+[^|;&]*-[a-zA-Z]*a|\bgit\s+add\b'; then
  tree=$(git status --porcelain 2>/dev/null | awk '{print $NF}' | grep -E "$PROTO_RE")
  [ -n "$tree" ] && block "$tree"
fi

exit 0
