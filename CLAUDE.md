# Harness — Claude Code Plugin

This repo IS the plugin. Changes here take effect after the plugin is reloaded in Claude Code.

## Structure

- `.claude-plugin/plugin.json` — manifest (name, version, author)
- `scripts/statusline.sh` — status line script (branch, model, ctx%, rate limits)
- `skills/` — custom skills, one subdirectory per skill with a `SKILL.md` inside

## Adding a new skill

Create `skills/<name>/SKILL.md` with frontmatter:

```yaml
---
name: <name>
description: What it does and when to use it
---
```

Reload the plugin after adding. No other registration needed.

## Adding hooks

Create `hooks/hooks.json` following the Claude Code hook schema. Use `${CLAUDE_PLUGIN_ROOT}` to reference bundled scripts.

## After editing

Verify the plugin still loads cleanly — no JSON syntax errors in `plugin.json`.
