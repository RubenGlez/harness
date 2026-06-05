#!/usr/bin/env bash
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
INSTALLED_PLUGINS="$HOME/.claude/plugins/installed_plugins.json"
_backed_up=false

CUSTOM=false
[[ "${1:-}" == "--custom" ]] && CUSTOM=true

echo "⚙️  Harness setup"
echo "   Plugin dir: $HARNESS_DIR"
[[ "$CUSTOM" == true ]] && echo "   Mode: custom"
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

ask() {
  local prompt="$1"
  if [[ "$CUSTOM" == false ]]; then
    return 0
  fi
  printf "   %s [Y/n] " "$prompt"
  read -r reply
  [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]
}

# ── Plugin (Claude) ─────────────────────────────────────────────────────────────
# Skills, subagents, and MCPs are declared in plugin.json — the plugin owns them for Claude.
# Reinstall every run so cache stays in sync with source changes.

setup_plugin() {
  # Register marketplace if not already known
  local known_marketplaces="$HOME/.claude/plugins/known_marketplaces.json"
  if [[ ! -f "$known_marketplaces" ]] || ! jq -e '.harness' "$known_marketplaces" &>/dev/null; then
    claude plugin marketplace add "$HARNESS_DIR" 2>/dev/null \
      && echo "✓  Marketplace registered (harness)" \
      || echo "   Warning: could not register marketplace"
  else
    echo "✓  Marketplace already registered (harness)"
  fi

  # Install only if not already installed — Claude auto-updates on startup via git SHA
  local installed
  installed=$(jq -r '.plugins["harness@harness"][0].installPath // ""' "$INSTALLED_PLUGINS" 2>/dev/null)
  if [[ -z "$installed" ]]; then
    claude plugin install harness@harness 2>/dev/null \
      && echo "✓  Plugin installed (harness@harness)" \
      || echo "   Warning: could not install plugin"
  else
    echo "✓  Plugin already installed (harness@harness)"
  fi
}

# ── Legacy cleanup ─────────────────────────────────────────────────────────────
# MCPs and skill symlinks were previously written to settings.json / ~/.claude/skills
# by this script. The plugin now owns them for Claude.

cleanup_legacy() {
  # Remove MCP entries from settings.json that are now declared in plugin.json
  local mcp_file="$HARNESS_DIR/mcp/servers.json"
  if [[ -f "$mcp_file" ]]; then
    local changed=false
    while IFS= read -r key; do
      if jq -e ".mcpServers[\"$key\"]" "$SETTINGS" &>/dev/null 2>&1; then
        [[ "$changed" == false ]] && backup
        update_settings "del(.mcpServers[\"$key\"])"
        changed=true
      fi
    done < <(jq -r 'keys[]' "$mcp_file")
    [[ "$changed" == true ]] && echo "✓  Removed legacy MCPs from settings.json (now in plugin)"
  fi

  # Remove skill symlinks from ~/.claude/skills that are now served by the plugin
  local claude_skills="$HOME/.claude/skills"
  if [[ -d "$claude_skills" ]]; then
    find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" -print0 |
    while IFS= read -r -d '' skill_md; do
      local name target
      name="$(basename "$(dirname "$skill_md")")"
      target="$claude_skills/$name"
      if [[ -L "$target" ]]; then
        rm "$target"
        echo "   removed legacy symlink: ~/.claude/skills/$name"
      fi
    done
  fi
}

# ── Codex ──────────────────────────────────────────────────────────────────────

setup_codex() {
  python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR"
}

# ── Skills (Codex only — Claude gets skills from the plugin) ───────────────────

link_skills_to() {
  local dest="$1"

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

  # Remove stale links from earlier harness skill names. Keep non-harness skills,
  # system skills, and real directories untouched.
  find "$dest" -maxdepth 1 -type l -print0 |
  while IFS= read -r -d '' link; do
    local resolved
    resolved="$(readlink "$link")"
    case "$resolved" in
      "$HARNESS_DIR"/skills/*)
        if [ ! -f "$link/SKILL.md" ]; then
          rm "$link"
          echo "   removed stale $(basename "$link")"
        fi
        ;;
    esac
  done

  find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" -print0 |
  while IFS= read -r -d '' skill_md; do
    local src name target
    src="$(dirname "$skill_md")"
    name="$(basename "$src")"
    target="$dest/$name"

    if [ -e "$target" ] && [ ! -L "$target" ]; then
      rm -rf "$target"
    fi

    ln -sfn "$src" "$target"
    echo "   linked $name"
  done
}

setup_skills() {
  local codex_skills="$HOME/.codex/skills"
  local skills_found
  skills_found=$(find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" | wc -l | tr -d ' ')

  if [[ "$skills_found" -eq 0 ]]; then
    echo "✓  Skills: none yet"
    return
  fi

  ask "Install skills?" || { echo "   Skills: skipped"; return; }

  echo "   Skills ($skills_found found):"
  echo "   → Codex  ($codex_skills)"
  link_skills_to "$codex_skills"
  echo "✓  Skills linked (Codex)"
}

# ── Rules ──────────────────────────────────────────────────────────────────────

setup_rules() {
  ask "Inject rules into CLAUDE.md / AGENTS.md?" || { echo "   Rules: skipped"; return; }
  python3 "$HARNESS_DIR/scripts/rules-config.py" "$HARNESS_DIR"
}

# ── Status line (Claude only, no plugin equivalent) ────────────────────────────

setup_statusline() {
  local script="$HARNESS_DIR/scripts/statusline.sh"
  local current
  current=$(jq -r '.statusLine.command // ""' "$SETTINGS" 2>/dev/null)

  if [[ "$current" == "bash $script" ]]; then
    echo "✓  Status line already configured"
    return
  fi

  ask "Install status line?" || { echo "   Status line: skipped"; return; }

  backup
  update_settings ".statusLine = {\"type\": \"command\", \"command\": \"bash $script\"}"
  echo "✓  Status line → $script"
}

# ── MCP servers (npm deps) ─────────────────────────────────────────────────────

setup_mcp_servers() {
  local mcp_root="$HARNESS_DIR/mcp"
  local installed=0
  for pkg_json in "$mcp_root"/*/package.json; do
    [[ -f "$pkg_json" ]] || continue
    local dir
    dir="$(dirname "$pkg_json")"
    local name
    name="$(basename "$dir")"
    ask "Install npm deps for MCP server '$name'?" || { echo "   MCP $name: skipped"; continue; }
    (cd "$dir" && npm install --silent 2>/dev/null) \
      && echo "✓  MCP $name — npm deps installed" \
      || echo "   Warning: npm install failed for $name"
    installed=$((installed + 1))
  done
  [[ $installed -eq 0 ]] && echo "✓  MCP servers: no npm packages to install"
}

# ── Run ────────────────────────────────────────────────────────────────────────

setup_plugin
cleanup_legacy
setup_mcp_servers
setup_codex
setup_skills
setup_rules
setup_statusline

echo ""
echo "Done. Restart Claude Code for changes to take effect."
