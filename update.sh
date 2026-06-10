#!/usr/bin/env bash
# Pulls the latest harness code and re-syncs all installed components.
#
# The Claude plugin reloads automatically on the next session (git SHA detection).
# This script handles everything else: Codex config, skill symlinks, and
# global rules.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "⬆️  Harness update"
echo "   Plugin dir: $HARNESS_DIR"
echo ""

# ── Pull ───────────────────────────────────────────────────────────────────────

echo "   Pulling latest changes..."
pull_output=$(git -C "$HARNESS_DIR" pull --ff-only 2>&1)
if echo "$pull_output" | grep -q "Already up to date"; then
  echo "✓  Already up to date"
else
  echo "✓  Repository updated"
  echo "$pull_output" | grep -v "^From\|^   \|Updating\|Fast-forward" | grep "." || true
fi
echo ""

# ── Plugin cache ──────────────────────────────────────────────────────────────
# Prune cached plugin versions that don't match the current HEAD SHA, so stale
# copies can't load alongside the current one. Claude Code re-caches the
# current version on the next session.

cache_dir="$HOME/.claude/plugins/cache/harness/harness"
if [[ -d "$cache_dir" ]]; then
  head_sha=$(git -C "$HARNESS_DIR" rev-parse --short=12 HEAD 2>/dev/null || echo "")
  registered=$(jq -r '.plugins["harness@harness"][0].version // ""' \
    "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null)
  for version_dir in "$cache_dir"/*/; do
    [[ -d "$version_dir" ]] || continue
    version=$(basename "$version_dir")
    [[ -n "$head_sha"    && "$version" == "$head_sha"    ]] && continue
    [[ -n "$registered"  && "$version" == "$registered"  ]] && continue
    rm -rf "$version_dir"
    echo "   pruned stale plugin cache: $version"
  done
fi

# ── Skill symlinks (Codex) ─────────────────────────────────────────────────────

codex_skills="$HOME/.codex/skills"
if [[ -d "$codex_skills" ]]; then
  # Remove stale links (skills removed from the repo)
  find "$codex_skills" -maxdepth 1 -type l -print0 |
  while IFS= read -r -d '' link; do
    resolved="$(readlink "$link")"
    case "$resolved" in
      "$HARNESS_DIR"/skills/*)
        if [[ ! -f "$link/SKILL.md" ]]; then
          rm "$link"
          echo "   removed stale skill: $(basename "$link")"
        fi
        ;;
    esac
  done

  # Add newly added skills
  find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" -print0 |
  while IFS= read -r -d '' skill_md; do
    src="$(dirname "$skill_md")"
    name="$(basename "$src")"
    target="$codex_skills/$name"
    if [[ ! -e "$target" ]]; then
      ln -sfn "$src" "$target"
      echo "✓  New skill linked: $name"
    fi
  done
  echo "✓  Skills (Codex) up to date"
fi

# ── Codex config (hooks) ───────────────────────────────────────────────────────

python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR"

# ── Rules ──────────────────────────────────────────────────────────────────────

python3 "$HARNESS_DIR/scripts/rules-config.py" "$HARNESS_DIR"

echo ""
echo "Done. Restart Claude Code to pick up the latest plugin changes."
