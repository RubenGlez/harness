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

# ── Hooks ──────────────────────────────────────────────────────────────────────

setup_hooks() {
  local file="$HARNESS_DIR/hooks/hooks.json"
  [[ -f "$file" ]] || { echo "✓  Hooks: no file"; return; }

  local count
  count=$(jq '[.hooks | to_entries[] | select(.value | length > 0)] | length' "$file")

  if [[ "$count" -eq 0 ]]; then
    echo "✓  Hooks: none defined"
    return
  fi

  backup
  local tmp; tmp=$(mktemp)
  jq --slurpfile h "$file" '.hooks = $h[0].hooks' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "✓  Hooks → Claude (settings.json)"
}

# ── MCPs ───────────────────────────────────────────────────────────────────────

setup_mcps() {
  local file="$HARNESS_DIR/mcp/servers.json"
  [[ -f "$file" ]] || { echo "✓  MCPs: no file"; return; }

  local count
  count=$(jq 'keys | length' "$file")

  if [[ "$count" -eq 0 ]]; then
    echo "✓  MCPs: none defined"
    return
  fi

  backup
  local tmp; tmp=$(mktemp)
  jq --slurpfile m "$file" '.mcpServers = $m[0]' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "✓  MCPs → Claude (settings.json)"
}

# ── Codex ──────────────────────────────────────────────────────────────────────

setup_codex() {
  python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR"
}

# ── Skills ─────────────────────────────────────────────────────────────────────

link_skills_to() {
  local dest="$1"

  # Guard against ~/.claude/skills or ~/.codex/skills being a symlink into
  # this repo — that would create circular links inside the working copy.
  if [ -L "$dest" ]; then
    local resolved
    resolved="$(readlink -f "$dest")"
    case "$resolved" in
      "$HARNESS_DIR"|"$HARNESS_DIR"/*)
        echo "   ⚠ $dest is a symlink into this repo — remove it and re-run" >&2
        return 1
        ;;
    esac
  fi

  mkdir -p "$dest"

  find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" -print0 |
  while IFS= read -r -d '' skill_md; do
    local src name target
    src="$(dirname "$skill_md")"
    name="$(basename "$src")"
    target="$dest/$name"

    # Remove a plain file/dir at target before replacing with symlink
    if [ -e "$target" ] && [ ! -L "$target" ]; then
      rm -rf "$target"
    fi

    ln -sfn "$src" "$target"
    echo "   linked $name"
  done
}

setup_skills() {
  local claude_skills="$HOME/.claude/skills"
  local codex_skills="$HOME/.codex/skills"
  local skills_found
  skills_found=$(find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" | wc -l | tr -d ' ')

  if [[ "$skills_found" -eq 0 ]]; then
    echo "✓  Skills: none yet"
    return
  fi

  echo "   Skills ($skills_found found):"
  echo "   → Claude ($claude_skills)"
  link_skills_to "$claude_skills"
  echo "   → Codex  ($codex_skills)"
  link_skills_to "$codex_skills"
  echo "✓  Skills linked"
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
setup_hooks
setup_mcps
setup_codex
setup_skills
setup_statusline

echo ""
echo "Done. Restart Claude Code for changes to take effect."
