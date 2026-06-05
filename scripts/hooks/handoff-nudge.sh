#!/usr/bin/env bash
# Nudge to run /handoff before closing when harness docs have changed.
# Stop — no stdin. Exits 0 always.

HARNESS=".harness"
[ ! -d "$HARNESS" ] && exit 0

changed=$(git status --porcelain "$HARNESS" 2>/dev/null | wc -l | tr -d ' ')
recent=$(git log --oneline --since="8 hours ago" -- "$HARNESS" 2>/dev/null | wc -l | tr -d ' ')

if [ "$changed" -gt 0 ] || [ "$recent" -gt 0 ]; then
  echo "──────────────────────────────────────────────────────────"
  echo " Harness docs changed this session."
  echo " Run /handoff to capture state for the next agent."
  echo "──────────────────────────────────────────────────────────"
fi

exit 0
