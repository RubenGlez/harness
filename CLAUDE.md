# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A personal Claude Code plugin — the repo itself is the installed plugin. It manages skills, hooks, MCP servers, and global AI rules across Claude Code and OpenAI Codex from a single source of truth.

## Install / uninstall

```bash
bash setup.sh           # full install
bash setup.sh --custom  # prompt per component
bash uninstall.sh       # reverse everything
```

Neither script requires Claude Code or Codex to be open. Both are idempotent and safe to re-run.

## Source of truth → target mapping

| File | What it controls |
|------|-----------------|
| `.claude-plugin/plugin.json` | Plugin manifest (name, version) |
| `hooks/hooks.json` | Hooks → `~/.claude/settings.json` and `~/.codex/config.toml` |
| `mcp/servers.json` | MCP servers → `~/.claude/settings.json` and `~/.codex/config.toml` |
| `rules/rules.md` | Injected into `~/.claude/CLAUDE.md` and `~/.agents/AGENTS.md` |
| `skills/` | Symlinked into `~/.claude/skills/` and `~/.codex/skills/` |
| `scripts/statusline.sh` | Status line → `~/.claude/settings.json` |

## Adding a skill

Create `skills/<name>/SKILL.md` with frontmatter:

```yaml
---
name: <name>
description: What it does and when to invoke it
---
```

Run `bash setup.sh` to symlink it. No other registration needed.

## Adding an MCP server

Add an entry to `mcp/servers.json` and run `bash setup.sh`. It syncs to both Claude and Codex automatically.

## Adding hooks

Edit `hooks/hooks.json` and run `bash setup.sh`.

## Editing global rules

Edit `rules/rules.md` and run `bash setup.sh`. The script updates the `<!-- harness:start --> ... <!-- harness:end -->` block in both `~/.claude/CLAUDE.md` and `~/.agents/AGENTS.md` without touching content outside the block.

## Key scripts

- `scripts/codex-config.py` — generates the harness-managed TOML block in `~/.codex/config.toml` from `hooks/hooks.json` and `mcp/servers.json`
- `scripts/rules-config.py` — injects/updates/removes the harness block in markdown files; prompts for confirmation on first write, replaces silently on updates
- `scripts/statusline.sh` — reads Claude API usage stats and renders the terminal status line

## Bumping the version

Edit `.claude-plugin/plugin.json` and re-run `bash setup.sh`. The script re-registers the plugin at the new version path automatically.
