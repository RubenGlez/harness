#!/usr/bin/env bash
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
INSTALLED_PLUGINS="$HOME/.claude/plugins/installed_plugins.json"
_backed_up=false

echo "🗑️  Harness uninstall"
echo ""

# ── Helpers ────────────────────────────────────────────────────────────────────

backup() {
  if [[ "$_backed_up" == false ]]; then
    cp "$SETTINGS" "$SETTINGS.bak"
    echo "   Backed up settings.json → settings.json.bak"
    _backed_up=true
  fi
}

update_settings() {
  local tmp; tmp=$(mktemp)
  jq "$1" "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
}

# ── Plugin ──────────────────────────────────────────────────────────────────────

uninstall_plugin() {
  local plugin_key="harness@harness"
  local version
  version=$(jq -r '.version' "$HARNESS_DIR/.claude-plugin/plugin.json")
  local install_path="$HOME/.claude/plugins/cache/harness/harness/$version"

  if [[ -L "$install_path" ]]; then
    rm "$install_path"
    # Clean up empty parent dirs left behind
    rmdir "$(dirname "$install_path")" 2>/dev/null || true
    rmdir "$(dirname "$(dirname "$install_path")")" 2>/dev/null || true
    echo "✓  Removed plugin symlink ($install_path)"
  fi

  local exists
  exists=$(jq --arg k "$plugin_key" '.plugins | has($k)' "$INSTALLED_PLUGINS" 2>/dev/null)
  if [[ "$exists" == "true" ]]; then
    local tmp; tmp=$(mktemp)
    jq --arg k "$plugin_key" 'del(.plugins[$k])' "$INSTALLED_PLUGINS" > "$tmp" && mv "$tmp" "$INSTALLED_PLUGINS"
    echo "✓  Removed from installed_plugins.json"
  fi

  local enabled
  enabled=$(jq --arg k "$plugin_key" '.enabledPlugins | has($k)' "$SETTINGS" 2>/dev/null)
  if [[ "$enabled" == "true" ]]; then
    backup
    local tmp; tmp=$(mktemp)
    jq --arg k "$plugin_key" 'del(.enabledPlugins[$k])' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    echo "✓  Removed from enabledPlugins"
  fi
}

# ── Skills ──────────────────────────────────────────────────────────────────────

uninstall_skills() {
  local removed=0

  for dest in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
    [[ -d "$dest" ]] || continue
    find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" -print0 |
    while IFS= read -r -d '' skill_md; do
      local name target
      name="$(basename "$(dirname "$skill_md")")"
      target="$dest/$name"
      if [[ -L "$target" ]]; then
        rm "$target"
        removed=$((removed + 1))
        echo "   removed $name from $dest"
      fi
    done
  done

  echo "✓  Skills unlinked"
}

# ── Hooks / MCPs ────────────────────────────────────────────────────────────────

uninstall_hooks() {
  echo "✓  Hooks: managed by the plugin, nothing to remove from settings.json"
}

uninstall_mcps() {
  local key="agent-orchestrator"
  local exists
  exists=$(jq --arg k "$key" '(.mcpServers // {}) | has($k)' "$SETTINGS" 2>/dev/null)
  if [[ "$exists" == "true" ]]; then
    backup
    update_settings 'del(.mcpServers["agent-orchestrator"])'
    echo "✓  Removed legacy mcpServer: $key"
  else
    echo "✓  MCPs: nothing to remove"
  fi
}

# ── Codex ───────────────────────────────────────────────────────────────────────

uninstall_codex() {
  python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" --uninstall
}

# ── Rules ───────────────────────────────────────────────────────────────────────

uninstall_rules() {
  python3 "$HARNESS_DIR/scripts/rules-config.py" "$HARNESS_DIR" --uninstall
}

# ── Status line ─────────────────────────────────────────────────────────────────

uninstall_statusline() {
  local current
  current=$(jq -r '.statusLine.command // ""' "$SETTINGS" 2>/dev/null)
  if [[ "$current" == "bash $HARNESS_DIR/scripts/statusline.sh" ]]; then
    backup
    update_settings 'del(.statusLine)'
    echo "✓  Removed statusLine from settings.json"
  else
    echo "✓  Status line: nothing to remove"
  fi
}

# ── Run ─────────────────────────────────────────────────────────────────────────

uninstall_plugin
uninstall_skills
uninstall_hooks
uninstall_mcps
uninstall_codex
uninstall_rules
uninstall_statusline
rm -f "$HOME/.harness_dir"

echo ""
echo "Done. Restart Claude Code for changes to take effect."
