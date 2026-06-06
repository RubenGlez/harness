# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A reusable Claude Code plugin repository. The repo itself is the installed plugin and manages skills, reusable subagents, MCP wiring, and global AI rules across Claude Code and OpenAI Codex from a single source of truth.

## Install / uninstall

```bash
bash setup.sh           # interactive wizard (recommended)
bash setup.sh --full    # install everything without prompts
bash update.sh          # pull latest and re-sync all components
bash uninstall.sh       # reverse everything
```

Neither script requires Claude Code or Codex to be open. Both are idempotent and safe to re-run.

## How it works

**Claude** gets everything through the plugin system:
- Skills, subagents, and the bundled MCP are declared in `.claude-plugin/plugin.json` and managed by Claude Code
- Plugin version tracks the git commit SHA (no hardcoded version), so Claude Code auto-updates the cache on startup after each commit

**Codex** gets a compatibility layer from `setup.sh`:
- Skills symlinked into `~/.codex/skills/`
- MCP config and hooks written to `~/.codex/config.toml`

**Both** share injected global rules (`~/.claude/CLAUDE.md` and `~/.agents/AGENTS.md`).

## Source of truth -> target mapping

| File | What it controls |
|------|-----------------|
| `.claude-plugin/plugin.json` | Plugin manifest - skills and MCPs for Claude |
| `.claude-plugin/marketplace.json` | Marketplace manifest for `claude plugin install` |
| `agents/` | Reusable subagents packaged with the plugin |
| `mcp/agent-orchestrator/` | Bundled AFK MCP server for staged agent orchestration, markdown exports, and history lifecycle tools |
| `mcp/agent-dashboard/` | Parallel local dashboard MCP for pipeline and worker visibility; auto-opens browser, surfaces low-overhead health signals and short per-repo health history, exposes safe controls, and idles out when nothing is running |
| `mcp/servers.json` | Codex mirror for the bundled MCP -> `~/.codex/config.toml` |
| `hooks/hooks.json` | Hooks -> `~/.codex/config.toml` |
| `rules/rules.md` | Injected into `~/.claude/CLAUDE.md` and `~/.agents/AGENTS.md` |
| `skills/` | Claude: registered via plugin. Codex: symlinked into `~/.codex/skills/` |
| `scripts/statusline.sh` | Status line -> `~/.claude/settings.json` |

## Adding a skill

Create `skills/<name>/SKILL.md` with frontmatter:

```yaml
---
name: <name>
description: What it does and when to invoke it
---
```

Run `bash setup.sh` to sync to Codex. For Claude, `git commit` your changes and reopen Claude Code - it auto-updates from the new git SHA.

## Adding a subagent

Create `agents/<name>.md` with YAML frontmatter. The plugin packages it automatically, and Claude Code discovers it from the plugin scope on the next session.

## Adding an MCP server

Bundled MCPs live under `mcp/<name>/` and are declared in `.claude-plugin/plugin.json`. Run `bash setup.sh` to install their npm deps and sync them to Codex.

`mcp/servers.json` mirrors the bundled MCP into Codex. Commit changes and run `bash setup.sh` to sync the local Codex config.

Current MCP behavior to remember:
- The orchestrator exposes `run_batch`, `get_batch_status`, `list_batches`, `archive_history`, `purge_history`, and `list_history`, plus markdown output variants for snapshots.
- The dashboard is read-mostly but can cancel pipelines, terminate workers, clean up finished worktrees, and surface low-overhead health signals plus short per-repo history; keep all UI strings in English.

## Adding hooks

Edit `hooks/hooks.json` and run `bash setup.sh`. Hooks apply to Codex only. Claude hooks live in `.claude-plugin/plugin.json`.

## Editing global rules

Edit `rules/rules.md` and run `bash setup.sh`. The script updates the `<!-- harness:start --> ... <!-- harness:end -->` block in both `~/.claude/CLAUDE.md` and `~/.agents/AGENTS.md` without touching content outside the block.

## Project sync standard

In every project, `AGENTS.md` is the canonical agent-facing document for shared project context. `CLAUDE.md` should contain only `@AGENTS.md`, so both agents resolve the same source of truth.

## Key scripts

- `scripts/codex-config.py` - generates the harness-managed TOML block in `~/.codex/config.toml` from `hooks/hooks.json` and `mcp/servers.json`
- `scripts/rules-config.py` - injects/updates/removes the harness block in markdown files; prompts for confirmation on first write, replaces silently on updates
- `scripts/statusline.sh` - reads Claude API usage stats and renders the terminal status line

## Versioning

No manual version bumping needed. The plugin uses the git commit SHA as its version - Claude Code detects a new SHA on startup and updates automatically.
