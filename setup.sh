#!/usr/bin/env bash
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
INSTALLED_PLUGINS="$HOME/.claude/plugins/installed_plugins.json"
_backed_up=false

echo "⚙️  Harness setup"
echo "   Plugin dir: $HARNESS_DIR"
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
  local tmp
  tmp=$(mktemp)
  jq "$1" "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
}

# ── Plugin install ─────────────────────────────────────────────────────────────

setup_plugin() {
  local version
  version=$(jq -r '.version' "$HARNESS_DIR/.claude-plugin/plugin.json")

  local plugin_key="harness@harness"
  local install_path="$HOME/.claude/plugins/cache/harness/harness/$version"

  local existing_path
  existing_path=$(jq -r ".plugins[\"$plugin_key\"][0].installPath // \"\"" "$INSTALLED_PLUGINS" 2>/dev/null)

  if [[ "$existing_path" == "$install_path" ]]; then
    echo "✓  Plugin already installed (v$version)"
  else
    # Symlink repo into the plugin cache — git pull = instant update, no copy needed
    mkdir -p "$(dirname "$install_path")"
    ln -sfn "$HARNESS_DIR" "$install_path"

    local now git_sha
    now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    git_sha=$(git -C "$HARNESS_DIR" rev-parse HEAD 2>/dev/null || echo "")

    local tmp
    tmp=$(mktemp)
    jq --arg key "$plugin_key" \
       --arg scope "user" \
       --arg path "$install_path" \
       --arg ver "$version" \
       --arg now "$now" \
       --arg sha "$git_sha" \
       '.plugins[$key] = [{scope: $scope, installPath: $path, version: $ver, installedAt: $now, lastUpdated: $now, gitCommitSha: $sha}]' \
       "$INSTALLED_PLUGINS" > "$tmp" && mv "$tmp" "$INSTALLED_PLUGINS"

    backup
    update_settings ".enabledPlugins[\"$plugin_key\"] = true"
    echo "✓  Plugin installed (harness@harness v$version)"
  fi
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

setup_plugin
setup_statusline

echo ""
echo "Done. Restart Claude Code for changes to take effect."
