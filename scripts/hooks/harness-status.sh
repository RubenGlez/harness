#!/usr/bin/env bash
# Show harness workflow state at session start.
# SessionStart — no stdin. Exits 0 always.

HARNESS=".harness"
[ ! -d "$HARNESS" ] && exit 0

echo "┌─ Harness ───────────────────────────────────────────────┐"

# Current phase — first Phase heading not fully checked off
if [ -f "$HARNESS/engineering/implementation-plan.md" ]; then
  phase=$(grep -m1 "^## Phase" "$HARNESS/engineering/implementation-plan.md" | sed 's/^## //')
  [ -n "$phase" ] && echo "│  Phase : $phase"
fi

# Feature counts
features_dir="$HARNESS/engineering/features"
if [ -d "$features_dir" ] && ls "$features_dir"/*.md &>/dev/null; then
  total=$(ls "$features_dir"/*.md | wc -l | tr -d ' ')
  done_count=$(grep -rl '\*\*Status\*\*: done' "$features_dir" 2>/dev/null | wc -l | tr -d ' ')
  blocked_count=$(grep -rl '\*\*Status\*\*: blocked' "$features_dir" 2>/dev/null | wc -l | tr -d ' ')
  planned_count=$((total - done_count - blocked_count))
  echo "│  Features : ${done_count} done · ${planned_count} planned · ${blocked_count} blocked"
fi

# Last QA
if [ -f "$HARNESS/qa/report.md" ]; then
  qa_line=$(grep -m1 "^# QA Report" "$HARNESS/qa/report.md")
  if [ -n "$qa_line" ]; then
    qa_date=$(echo "$qa_line" | sed 's/^# QA Report — //')
    echo "│  Last QA : $qa_date"
    open_issues=$(grep -c '^\- \[ \]' "$HARNESS/qa/report.md" 2>/dev/null || echo 0)
    [ "$open_issues" -gt 0 ] && echo "│  Open issues : $open_issues"
  fi
fi

echo "└─────────────────────────────────────────────────────────┘"
exit 0
