#!/usr/bin/env bash
# Nudge to run /handoff before closing when harness docs have changed.
# .harness/ is gitignored, so detection is mtime-based (last 8 hours), not git-based.
# Stop — no stdin. Exits 0 always.

HARNESS=".harness"
[ ! -d "$HARNESS" ] && exit 0

recent=$(find "$HARNESS" -type f -mmin -480 2>/dev/null | head -1)

if [ -n "$recent" ]; then
  echo "──────────────────────────────────────────────────────────"
  echo " Harness docs changed recently."
  echo " Run /handoff to capture state for the next agent."
  echo "──────────────────────────────────────────────────────────"
fi

exit 0
