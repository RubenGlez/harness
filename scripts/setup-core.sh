#!/usr/bin/env bash
# Core install logic. Called by setup.sh (via wizard or --full).
#
# Env vars (set by setup.ts for custom installs):
#   HARNESS_SKILLS        comma-separated skill dirs to link in Codex (unset = all)
#   HARNESS_HOOKS         comma-separated hook ids for Codex config (unset = all)
#   HARNESS_NO_RULES=1    skip rules injection
#   HARNESS_NO_STATUSLINE=1  skip status line config
#   HARNESS_NO_CODEX=1    skip Codex setup entirely
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
  local tmp; tmp=$(mktemp)
  jq "$1" "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
}

in_list() { echo ",$2," | grep -qF ",$1,"; }

# ── Plugin (Claude) ─────────────────────────────────────────────────────────────

setup_plugin() {
  local head_sha
  head_sha=$(git -C "$HARNESS_DIR" rev-parse --short=12 HEAD 2>/dev/null || echo "")
  local known_marketplaces="$HOME/.claude/plugins/known_marketplaces.json"
  if [[ ! -f "$known_marketplaces" ]] || ! jq -e '.harness' "$known_marketplaces" &>/dev/null; then
    claude plugin marketplace add "$HARNESS_DIR" 2>/dev/null \
      && echo "✓  Marketplace registered (harness)" \
      || echo "   Warning: could not register marketplace"
  else
    echo "✓  Marketplace already registered (harness)"
  fi

  local installed installed_version
  installed=$(jq -r '.plugins["harness@harness"][0].installPath // ""' "$INSTALLED_PLUGINS" 2>/dev/null)
  installed_version=$(jq -r '.plugins["harness@harness"][0].version // ""' "$INSTALLED_PLUGINS" 2>/dev/null)
  if [[ -z "$installed" ]]; then
    claude plugin install harness@harness 2>/dev/null \
      && echo "✓  Plugin installed (harness@harness)" \
      || echo "   Warning: could not install plugin"
  elif [[ -n "$head_sha" && "$installed_version" != "$head_sha" ]]; then
    if command -v claude &>/dev/null && claude plugin update harness@harness >/dev/null 2>&1; then
      echo "✓  Plugin updated (harness@harness: $installed_version → $head_sha)"
    else
      echo "   Warning: plugin is installed at $installed_version but repo is $head_sha"
      echo "   Run: claude plugin update harness@harness"
    fi
  else
    echo "✓  Plugin already installed (harness@harness)"
  fi
}

# ── Legacy cleanup ─────────────────────────────────────────────────────────────

cleanup_legacy() {
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
  [[ "${HARNESS_NO_CODEX:-}" == "1" ]] && { echo "   Codex: skipped"; return; }
  python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR"
}

# ── Skills (Codex only) ────────────────────────────────────────────────────────

link_skills_to() {
  local dest="$1"
  local filter_set="${HARNESS_SKILLS+SET}"
  local filter="${HARNESS_SKILLS:-}"

  if [[ -L "$dest" ]]; then
    local resolved; resolved="$(readlink -f "$dest")"
    case "$resolved" in
      "$HARNESS_DIR"|"$HARNESS_DIR"/*) echo "   ⚠ $dest is a symlink into this repo — remove it and re-run" >&2; return 1 ;;
    esac
  fi

  mkdir -p "$dest"

  find "$dest" -maxdepth 1 -type l -print0 |
  while IFS= read -r -d '' link; do
    local resolved; resolved="$(readlink "$link")"
    case "$resolved" in
      "$HARNESS_DIR"/skills/*)
        if [[ ! -f "$link/SKILL.md" ]]; then
          rm "$link"
          echo "   removed stale $(basename "$link")"
        fi
        ;;
    esac
  done

  find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" -print0 |
  while IFS= read -r -d '' skill_md; do
    local src name target
    src="$(dirname "$skill_md")"; name="$(basename "$src")"
    if [[ "$filter_set" == "SET" ]] && ! in_list "$name" "$filter"; then continue; fi
    target="$dest/$name"
    [[ -e "$target" && ! -L "$target" ]] && rm -rf "$target"
    ln -sfn "$src" "$target"
    echo "   linked $name"
  done
}

setup_skills() {
  [[ "${HARNESS_NO_CODEX:-}" == "1" ]] && { echo "   Skills (Codex): skipped"; return; }
  local codex_skills="$HOME/.codex/skills"
  local skills_found
  skills_found=$(find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" | wc -l | tr -d ' ')
  [[ "$skills_found" -eq 0 ]] && { echo "✓  Skills: none yet"; return; }
  echo "   Skills → Codex ($codex_skills):"
  link_skills_to "$codex_skills"
  echo "✓  Skills linked (Codex)"
}

# ── Rules ──────────────────────────────────────────────────────────────────────

setup_rules() {
  [[ "${HARNESS_NO_RULES:-}" == "1" ]] && { echo "   Rules: skipped"; return; }
  python3 "$HARNESS_DIR/scripts/rules-config.py" "$HARNESS_DIR"
}

# ── Status line ────────────────────────────────────────────────────────────────

setup_statusline() {
  [[ "${HARNESS_NO_STATUSLINE:-}" == "1" ]] && { echo "   Status line: skipped"; return; }
  local script="$HARNESS_DIR/scripts/statusline.sh"
  local current; current=$(jq -r '.statusLine.command // ""' "$SETTINGS" 2>/dev/null)
  if [[ "$current" == "bash $script" ]]; then
    echo "✓  Status line already configured"; return
  fi
  backup
  update_settings ".statusLine = {\"type\": \"command\", \"command\": \"bash $script\"}"
  echo "✓  Status line → $script"
}

# ── Doctier ────────────────────────────────────────────────────────────────────

check_doctier() {
  if ! command -v doctier &>/dev/null; then
    echo "   ⚠ doctier not found — doc skills need it (encrypted .harness/ tracking)."
    echo "     Install: brew tap RubenGlez/doctier https://github.com/RubenGlez/doctier && brew install doctier"
  else
    echo "✓  doctier available"
  fi
}

# ── Run ────────────────────────────────────────────────────────────────────────

echo "$HARNESS_DIR" > "$HOME/.harness_dir"

setup_plugin
cleanup_legacy
setup_codex
setup_skills
setup_rules
setup_statusline
check_doctier

echo ""
echo "Done. Restart Claude Code for changes to take effect."
