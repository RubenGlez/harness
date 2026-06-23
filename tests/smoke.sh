#!/usr/bin/env bash
# Smoke tests for harness scripts.
# Runs entirely in isolated temp dirs — nothing in your real HOME is touched.
#
# Usage: bash tests/smoke.sh
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_DIR="$HARNESS_DIR/tests"
export PATH="$TESTS_DIR/bin:$PATH"

PASS=0; FAIL=0
CLEANUP_DIRS=()
trap 'rm -rf "${CLEANUP_DIRS[@]:-}"' EXIT

# ── Framework ──────────────────────────────────────────────────────────────────

_green() { printf '\033[32m%s\033[0m' "$*"; }
_red()   { printf '\033[31m%s\033[0m' "$*"; }

pass() { printf '  %s  %s\n' "$(_green ✓)" "$1"; PASS=$((PASS+1)); }
fail() { printf '  %s  %s\n' "$(_red   ✗)" "$1"; FAIL=$((FAIL+1)); }

section() {
  echo ""
  echo "$1"
  printf '─%.0s' $(seq 1 ${#1}); echo
}

check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

# Create an isolated fake HOME with the minimum structure setup/uninstall expect.
new_fake_home() {
  local d; d=$(mktemp -d)
  CLEANUP_DIRS+=("$d")
  mkdir -p "$d/.claude/plugins" "$d/.codex/skills" "$d/.agents"
  printf '{"mcpServers":{},"enabledPlugins":{}}' > "$d/.claude/settings.json"
  printf '{"plugins":{}}'                         > "$d/.claude/plugins/installed_plugins.json"
  printf '{}'                                     > "$d/.claude/plugins/known_marketplaces.json"
  touch "$d/.claude/CLAUDE.md" "$d/.agents/AGENTS.md"
  echo "$d"
}

# Run setup-core.sh against a fake HOME.
# Usage: run_setup <fake_home> [EXTRA_VAR=value ...]
run_setup() {
  local h="$1"; shift
  env HOME="$h" HARNESS_NO_RULES=1 "$@" \
    bash "$HARNESS_DIR/scripts/setup-core.sh" >/dev/null 2>&1
}

# Run uninstall.sh against a fake HOME.
run_uninstall() {
  local h="$1"
  HOME="$h" bash "$HARNESS_DIR/uninstall.sh" >/dev/null 2>&1
}

# ── 1. JSON validity ───────────────────────────────────────────────────────────

section "1. JSON validity"

t_hooks_json_valid()   { python3 -c "import json; json.load(open('$HARNESS_DIR/hooks/codex-hooks.json'))"; }
t_plugin_json_valid()  { python3 -c "import json; json.load(open('$HARNESS_DIR/.claude-plugin/plugin.json'))"; }
check "hooks/codex-hooks.json"           t_hooks_json_valid
check ".claude-plugin/plugin.json" t_plugin_json_valid

# ── 2. File references ─────────────────────────────────────────────────────────

section "2. File references"

t_hook_ids_match_scripts() {
  python3 - <<PYEOF
import json, sys
from pathlib import Path
hooks_dir = Path('$HARNESS_DIR/scripts/hooks')
hooks = json.loads(Path('$HARNESS_DIR/hooks/codex-hooks.json').read_text())['hooks']
missing = []
for groups in hooks.values():
    for group in groups:
        hid = group.get('id')
        if hid and not (hooks_dir / f'{hid}.sh').exists():
            missing.append(f'{hid}.sh')
if missing:
    print('Missing scripts:', missing); sys.exit(1)
PYEOF
}

t_plugin_commands_ref_scripts() {
  python3 - <<PYEOF
import json, re, sys
from pathlib import Path
plugin = json.loads(Path('$HARNESS_DIR/.claude-plugin/plugin.json').read_text())
missing = []
for event_hooks in plugin.get('hooks', {}).values():
    for entry in event_hooks:
        for hook in entry.get('hooks', []):
            m = re.search(r'scripts/hooks/(\S+\.sh)', hook.get('command', ''))
            if m and not (Path('$HARNESS_DIR/scripts/hooks') / m.group(1)).exists():
                missing.append(m.group(1))
if missing:
    print('Missing scripts:', missing); sys.exit(1)
PYEOF
}

t_plugin_has_no_mcps() {
  python3 - <<PYEOF
import json, sys
from pathlib import Path
plugin = json.loads(Path('$HARNESS_DIR/.claude-plugin/plugin.json').read_text())
if plugin.get('mcpServers'):
    print('plugin.json still defines server entries'); sys.exit(1)
PYEOF
}

t_workflow_skills_exist() {
  python3 - <<PYEOF
import re, sys
from pathlib import Path
# Skills with stage_order in their SKILL.md are the pipeline stages; verify they all exist.
skills_dir = Path('$HARNESS_DIR/skills')
missing = []
for skill_md in skills_dir.rglob('SKILL.md'):
    if 'stage_order:' in skill_md.read_text():
        if not skill_md.exists():
            missing.append(str(skill_md.parent.name))
# Also verify setup.ts imports the relocated skills module
text = (Path('$HARNESS_DIR') / 'setup.ts').read_text()
if "import { loadSkills } from './scripts/load-skills.ts';" not in text:
    print('setup.ts does not import loadSkills from scripts/load-skills.ts'); sys.exit(1)
if missing:
    print('Missing skill dirs:', missing); sys.exit(1)
PYEOF
}

t_skill_frontmatter_valid() {
  python3 - <<PYEOF
import sys
from pathlib import Path
errors = []
for p in Path('$HARNESS_DIR/skills').rglob('SKILL.md'):
    text = p.read_text()
    for field in ('name:', 'description:'):
        if field not in text:
            errors.append(f'{p.parent.name}: missing {field}')
if errors:
    print('\n'.join(errors)); sys.exit(1)
PYEOF
}

check "All hook ids match scripts/hooks/*.sh"           t_hook_ids_match_scripts
check "plugin.json commands reference existing scripts" t_plugin_commands_ref_scripts
check "plugin.json has no server entries"               t_plugin_has_no_mcps
check "Pipeline stage skills in SKILL.md all exist"     t_workflow_skills_exist
check "All SKILL.md have name and description"          t_skill_frontmatter_valid

# ── 3. codex-config.py ────────────────────────────────────────────────────────

section "3. codex-config.py"

t_codex_all_hooks() {
  local h; h=$(new_fake_home)
  HOME="$h" python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" >/dev/null
  grep -qF 'block-dangerous-git' "$h/.codex/config.toml"
}

t_codex_filter_hooks() {
  local h; h=$(new_fake_home)
  HARNESS_HOOKS=harness-status HOME="$h" \
    python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" >/dev/null
  grep -qF 'harness-status'       "$h/.codex/config.toml" &&
  ! grep -qF 'block-dangerous-git' "$h/.codex/config.toml"
}

t_codex_empty_hooks_no_hook_sections() {
  local h; h=$(new_fake_home)
  HARNESS_HOOKS='' HOME="$h" \
    python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" >/dev/null
  ! grep -qF '[[hooks.' "$h/.codex/config.toml" 2>/dev/null
}

t_codex_no_id_field_in_toml() {
  local h; h=$(new_fake_home)
  HOME="$h" python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" >/dev/null
  ! grep -q '^id = ' "$h/.codex/config.toml"
}

t_codex_output_is_parseable() {
  local h; h=$(new_fake_home)
  HOME="$h" python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" >/dev/null
  python3 - <<PY
from pathlib import Path
import tomllib
tomllib.loads(Path("$h/.codex/config.toml").read_text())
PY
}

t_harness_gitignore_stdout_empty() {
  local d; d=$(mktemp -d)
  mkdir -p "$d/.harness"
  git -C "$d" init -q
  local out
  out=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/.harness/product.md"}}' "$d" \
    | bash "$HARNESS_DIR/scripts/hooks/harness-gitignore.sh")
  [[ -z "$out" ]]
}

t_lint_design_stdout_empty() {
  local d; d=$(mktemp -d)
  touch "$d/DESIGN.md"
  PATH="$d:$PATH"
  cat > "$d/npx" <<'EOF'
#!/usr/bin/env bash
echo "fake linter output"
exit 0
EOF
  chmod +x "$d/npx"
  local out
  out=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/DESIGN.md"}}' "$d" \
    | bash "$HARNESS_DIR/scripts/hooks/lint-design.sh")
  [[ -z "$out" ]]
}

t_codex_uninstall_removes_block() {
  local h; h=$(new_fake_home)
  HOME="$h" python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" >/dev/null
  HOME="$h" python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" --uninstall >/dev/null
  ! grep -qF 'harness:start' "$h/.codex/config.toml" 2>/dev/null
}

t_codex_idempotent() {
  local h; h=$(new_fake_home)
  HOME="$h" python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" >/dev/null
  local first; first=$(cat "$h/.codex/config.toml")
  HOME="$h" python3 "$HARNESS_DIR/scripts/codex-config.py" "$HARNESS_DIR" >/dev/null
  local second; second=$(cat "$h/.codex/config.toml")
  [[ "$first" == "$second" ]]
}

check "Generates TOML with all hooks (no filter)"    t_codex_all_hooks
check "Filters to selected hooks"                    t_codex_filter_hooks
check "Empty HARNESS_HOOKS writes no hook sections"  t_codex_empty_hooks_no_hook_sections
check "id field absent from TOML output"             t_codex_no_id_field_in_toml
check "Generated TOML parses cleanly"                t_codex_output_is_parseable
check "harness-gitignore leaves stdout empty"        t_harness_gitignore_stdout_empty
check "lint-design leaves stdout empty"              t_lint_design_stdout_empty
check "--uninstall removes harness block"             t_codex_uninstall_removes_block
check "Idempotent (double-run yields same output)"   t_codex_idempotent

# ── 4. setup-core.sh ──────────────────────────────────────────────────────────

section "4. setup-core.sh"

t_setup_creates_harness_dir() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  [[ -f "$h/.harness_dir" ]]
}

t_setup_harness_dir_correct_path() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  [[ "$(cat "$h/.harness_dir")" == "$HARNESS_DIR" ]]
}

t_setup_creates_skill_symlinks() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  [[ -L "$h/.codex/skills/ideate" ]]
}

t_setup_symlinks_point_into_repo() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  local target; target=$(readlink "$h/.codex/skills/ideate")
  [[ "$target" == "$HARNESS_DIR/skills/ideate" ]]
}

t_setup_skills_filter() {
  local h; h=$(new_fake_home)
  run_setup "$h" HARNESS_SKILLS=ideate
  [[ -L "$h/.codex/skills/ideate" ]] && [[ ! -e "$h/.codex/skills/handoff" ]]
}

t_setup_no_codex_skips_config() {
  local h; h=$(new_fake_home)
  run_setup "$h" HARNESS_NO_CODEX=1
  [[ ! -f "$h/.codex/config.toml" ]]
}

t_setup_no_codex_skips_skills() {
  local h; h=$(new_fake_home)
  run_setup "$h" HARNESS_NO_CODEX=1
  [[ ! -L "$h/.codex/skills/ideate" ]]
}

t_setup_imports_loadSkills() {
  python3 - <<PYEOF
from pathlib import Path
text = (Path('$HARNESS_DIR') / 'setup.ts').read_text()
if "import { loadSkills } from './scripts/load-skills.ts';" not in text:
    print('setup.ts does not import loadSkills from scripts/load-skills.ts'); sys.exit(1)
PYEOF
}

t_setup_configures_statusline() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  grep -q 'statusline.sh' "$h/.claude/settings.json"
}

t_setup_no_statusline_skips_it() {
  local h; h=$(new_fake_home)
  run_setup "$h" HARNESS_NO_STATUSLINE=1
  ! grep -q 'statusline.sh' "$h/.claude/settings.json"
}

t_setup_idempotent() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  run_setup "$h"  # second run must not error
}

t_setup_updates_stale_claude_plugin() {
  local h; h=$(new_fake_home)
  local head; head=$(git -C "$HARNESS_DIR" rev-parse --short=12 HEAD)
  mkdir -p "$h/.claude/plugins/cache/harness/harness/oldversion"
  cat > "$h/.claude/plugins/installed_plugins.json" <<EOF
{"plugins":{"harness@harness":[{"version":"oldversion","installPath":"$h/.claude/plugins/cache/harness/harness/oldversion"}]}}
EOF
  run_setup "$h"
  python3 - <<PYEOF
import json, sys
data = json.load(open('$h/.claude/plugins/installed_plugins.json'))
version = data['plugins']['harness@harness'][0]['version']
sys.exit(0 if version == '$head' else 1)
PYEOF
}

check "Creates ~/.harness_dir"                       t_setup_creates_harness_dir
# shellcheck disable=SC2088  # literal tilde in a test description, not a path
check "~/.harness_dir contains the correct path"     t_setup_harness_dir_correct_path
check "Creates skill symlinks in ~/.codex/skills"    t_setup_creates_skill_symlinks
check "Skill symlinks point into the repo"           t_setup_symlinks_point_into_repo
check "HARNESS_SKILLS limits which skills are linked" t_setup_skills_filter
check "HARNESS_NO_CODEX=1 skips Codex config"        t_setup_no_codex_skips_config
check "HARNESS_NO_CODEX=1 skips skill symlinks"      t_setup_no_codex_skips_skills
check "setup.ts imports the relocated skill loader"  t_setup_imports_loadSkills
check "Configures statusline in settings.json"       t_setup_configures_statusline
check "HARNESS_NO_STATUSLINE=1 skips statusline"     t_setup_no_statusline_skips_it
check "Idempotent (safe to run twice)"               t_setup_idempotent
check "Updates stale Claude plugin registration"     t_setup_updates_stale_claude_plugin

# ── 5. uninstall.sh ───────────────────────────────────────────────────────────

section "5. uninstall.sh"

t_uninstall_removes_harness_dir() {
  local h; h=$(new_fake_home)
  run_setup "$h"; run_uninstall "$h"
  [[ ! -f "$h/.harness_dir" ]]
}

t_uninstall_removes_skill_symlinks() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  [[ -L "$h/.codex/skills/ideate" ]]  # sanity: was created
  run_uninstall "$h"
  [[ ! -L "$h/.codex/skills/ideate" ]]
}

t_uninstall_removes_codex_block() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  grep -qF 'harness:start' "$h/.codex/config.toml"  # sanity: was written
  run_uninstall "$h"
  ! grep -qF 'harness:start' "$h/.codex/config.toml" 2>/dev/null
}

t_uninstall_removes_statusline() {
  local h; h=$(new_fake_home)
  run_setup "$h"
  grep -q 'statusline.sh' "$h/.claude/settings.json"  # sanity: was set
  run_uninstall "$h"
  ! grep -q 'statusline.sh' "$h/.claude/settings.json"
}

t_uninstall_idempotent() {
  local h; h=$(new_fake_home)
  run_setup "$h"; run_uninstall "$h"; run_uninstall "$h"  # second run must not error
}

check "Removes ~/.harness_dir"                  t_uninstall_removes_harness_dir
check "Removes skill symlinks from Codex"       t_uninstall_removes_skill_symlinks
check "Removes harness block from Codex config" t_uninstall_removes_codex_block
check "Removes statusline from settings.json"   t_uninstall_removes_statusline
check "Idempotent (safe to run twice)"          t_uninstall_idempotent

# ── 6. update.sh ──────────────────────────────────────────────────────────────

section "6. update.sh"

t_update_syncs_codex_config() {
  local h; h=$(new_fake_home)
  HOME="$h" bash "$HARNESS_DIR/update.sh" >/dev/null 2>&1
  grep -qF 'harness:start' "$h/.codex/config.toml"
}

t_update_syncs_skill_symlinks() {
  local h; h=$(new_fake_home)
  mkdir -p "$h/.codex/skills"
  HOME="$h" bash "$HARNESS_DIR/update.sh" >/dev/null 2>&1
  [[ -L "$h/.codex/skills/ideate" ]]
}

t_update_removes_stale_skill_links() {
  local h; h=$(new_fake_home)
  # Plant a stale symlink pointing into the repo skills dir but to a non-existent skill
  ln -s "$HARNESS_DIR/skills/nonexistent" "$h/.codex/skills/nonexistent"
  HOME="$h" bash "$HARNESS_DIR/update.sh" >/dev/null 2>&1
  [[ ! -L "$h/.codex/skills/nonexistent" ]]
}

t_update_updates_stale_claude_plugin_and_prunes_cache() {
  local h; h=$(new_fake_home)
  local head; head=$(git -C "$HARNESS_DIR" rev-parse --short=12 HEAD)
  mkdir -p "$h/.claude/plugins/cache/harness/harness/oldversion"
  cat > "$h/.claude/plugins/installed_plugins.json" <<EOF
{"plugins":{"harness@harness":[{"version":"oldversion","installPath":"$h/.claude/plugins/cache/harness/harness/oldversion"}]}}
EOF
  HOME="$h" bash "$HARNESS_DIR/update.sh" >/dev/null 2>&1
  python3 - <<PYEOF
import json, sys
data = json.load(open('$h/.claude/plugins/installed_plugins.json'))
version = data['plugins']['harness@harness'][0]['version']
sys.exit(0 if version == '$head' else 1)
PYEOF
  [[ ! -d "$h/.claude/plugins/cache/harness/harness/oldversion" ]]
}

check "Syncs Codex config (hooks)" t_update_syncs_codex_config
check "Syncs skill symlinks"              t_update_syncs_skill_symlinks
check "Removes stale skill symlinks"      t_update_removes_stale_skill_links
check "Updates stale Claude plugin and prunes cache" t_update_updates_stale_claude_plugin_and_prunes_cache

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
printf '%.0s─' $(seq 1 38); echo
total=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  printf '  %d tests: %s\n\n' "$total" "$(_green "all $total passed")"
else
  printf '  %d tests: %s, %s\n\n' "$total" "$(_green "$PASS passed")" "$(_red "$FAIL failed")"
fi

[[ $FAIL -eq 0 ]]
