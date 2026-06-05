#!/usr/bin/env bash
# Claude Code status line
# Reads JSON from stdin and prints a formatted status line.

input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
model=$(echo "$input" | jq -r '.model.display_name // ""')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Git branch (skip optional locks to avoid stalling)
branch=""
if [ -n "$cwd" ] && [ -d "$cwd/.git" ] || git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
fi

# Build the output
parts=()

# Branch with icon
if [ -n "$branch" ]; then
  parts+=("$(printf '\033[36m⎇ %s\033[0m' "$branch")")
fi

# Model
if [ -n "$model" ]; then
  parts+=("$(printf '\033[35m%s\033[0m' "$model")")
fi

# Context usage
if [ -n "$used_pct" ]; then
  pct_int=$(printf '%.0f' "$used_pct")
  if [ "$pct_int" -ge 80 ]; then
    color='\033[31m'
  elif [ "$pct_int" -ge 50 ]; then
    color='\033[33m'
  else
    color='\033[32m'
  fi
  parts+=("$(printf "${color}ctx:%d%%\033[0m" "$pct_int")")
fi

# Rate limits (Claude Pro — only present after first response)
limit_color() {
  local pct=$1
  if [ "$pct" -ge 80 ]; then printf '\033[31m'
  elif [ "$pct" -ge 50 ]; then printf '\033[33m'
  else printf '\033[32m'
  fi
}

five_hour=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
seven_day=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

if [ -n "$five_hour" ]; then
  pct_int=$(printf '%.0f' "$five_hour")
  color=$(limit_color "$pct_int")
  parts+=("$(printf "${color}5h:%d%%\033[0m" "$pct_int")")
fi

if [ -n "$seven_day" ]; then
  pct_int=$(printf '%.0f' "$seven_day")
  color=$(limit_color "$pct_int")
  parts+=("$(printf "${color}7d:%d%%\033[0m" "$pct_int")")
fi

# Join with separator
result=""
for part in "${parts[@]}"; do
  if [ -z "$result" ]; then
    result="$part"
  else
    result="$result $(printf '\033[90m|\033[0m') $part"
  fi
done

printf '%s' "$result"
