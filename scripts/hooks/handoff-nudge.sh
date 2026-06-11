#!/usr/bin/env bash
# Nudge to run /handoff before closing when harness docs have changed.
# .harness/ is gitignored, so detection is mtime-based (last 8 hours), not git-based.
# Stop — no stdin. Exits 0 always.
# Stop hook stdout is parsed as JSON by Claude Code and Codex.

HARNESS=".harness"
[ ! -d "$HARNESS" ] && exit 0

recent=$(find "$HARNESS" -type f -mmin -480 2>/dev/null | head -1)

if [ -n "$recent" ]; then
  jq -n --arg message "Harness docs changed recently.
Run /handoff to capture state for the next agent." \
    '{systemMessage: $message, suppressOutput: true}'
fi

exit 0
