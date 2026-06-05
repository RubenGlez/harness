#!/usr/bin/env bash
# Pulls the latest harness code and re-syncs all installed components.
#
# The Claude plugin reloads automatically on the next session (git SHA detection).
# This script handles everything else: npm deps, Codex config, skill symlinks,
# and global rules.
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

# ── MCP npm deps ───────────────────────────────────────────────────────────────

for pkg_json in "$HARNESS_DIR/mcp"/*/package.json; do
  [[ -f "$pkg_json" ]] || continue
  dir="$(dirname "$pkg_json")"
  name="$(basename "$dir")"
  (cd "$dir" && pnpm install --silent 2>/dev/null) \
    && echo "✓  MCP $name — deps up to date" \
    || echo "   Warning: pnpm install failed for $name"
done

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
  added=0
  find "$HARNESS_DIR/skills" -name "SKILL.md" -not -path "*/deprecated/*" -print0 |
  while IFS= read -r -d '' skill_md; do
    src="$(dirname "$skill_md")"
    name="$(basename "$src")"
    target="$codex_skills/$name"
    if [[ ! -e "$target" ]]; then
      ln -sfn "$src" "$target"
      echo "✓  New skill linked: $name"
      added=$((added + 1))
    fi
  done
  echo "✓  Skills (Codex) up to date"
fi

# ── Codex config (hooks + MCPs) ────────────────────────────────────────────────

python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR"

# ── Rules ──────────────────────────────────────────────────────────────────────

python3 "$HARNESS_DIR/scripts/rules-config.py" "$HARNESS_DIR"

echo ""
echo "Done. Restart Claude Code to pick up the latest plugin changes."
