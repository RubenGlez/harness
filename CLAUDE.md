# Harness — Claude Code Plugin

This repo IS the plugin. Changes here take effect after the plugin is reloaded in Claude Code.

## Structure

- `.claude-plugin/plugin.json` — manifest (name, version, author)
- `agents/` — subagents invoked by Claude via the Agent tool
  - `argent-environment-inspector.md` — inspects mobile project environment
  - `references/quality-control-checklist.md` — QA schema reference for the inspector
- `hooks/hooks.json` — PreToolUse hook that runs RTK for Bash token savings
- `rules/argent.md` — always-on instructions for Argent MCP tool usage
- `scripts/statusline.sh` — status line script (branch, model, ctx%, rate limits)
- `skills/` — custom skills go here as `skills/<name>/SKILL.md`

## Adding a new skill

Create `skills/<name>/SKILL.md` with frontmatter:
```yaml
---
name: <name>
description: What it does and when to use it
---
```

Then reload the plugin. No other registration needed.

## Adding a new agent

Create `agents/<name>.md` using the same frontmatter format as `argent-environment-inspector.md`.

## Hooks

`hooks/hooks.json` follows the Claude Code hook schema. Use `${CLAUDE_PLUGIN_ROOT}` to reference bundled scripts.

## After editing

Verify the plugin still loads cleanly — no JSON syntax errors in `plugin.json` or `hooks/hooks.json`.
