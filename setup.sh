#!/usr/bin/env bash
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"

echo "⚙️  Harness setup"
echo "   Plugin dir: $HARNESS_DIR"
echo ""

# ── Helpers ────────────────────────────────────────────────────────────────────

backup() {
  cp "$SETTINGS" "$SETTINGS.bak"
  echo "   Backed up settings.json → settings.json.bak"
}

update_settings() {
  local tmp
  tmp=$(mktemp)
  jq "$1" "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
}

# ── Status line ────────────────────────────────────────────────────────────────

setup_statusline() {
  local script="$HARNESS_DIR/scripts/statusline.sh"
  local current
  current=$(jq -r '.statusLine.command // ""' "$SETTINGS" 2>/dev/null)

  if [[ "$current" == "bash $script" ]]; then
    echo "✓  Status line already configured"
    return
  fi

  backup
  update_settings ".statusLine = {\"type\": \"command\", \"command\": \"bash $script\"}"
  echo "✓  Status line → $script"
}

# ── Run ────────────────────────────────────────────────────────────────────────

setup_statusline

echo ""
echo "Done. Restart Claude Code for changes to take effect."
