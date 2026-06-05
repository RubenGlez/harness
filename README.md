# Harness

Personal Claude Code and Codex plugin: a complete development workflow in skills, reusable subagents, custom hooks, a bundled AFK agent orchestrator MCP, and a terminal status line. It is meant to be installed once and then kept in sync from the repository.

## What's included

| Component | File | Purpose |
|-----------|------|---------|
| Skills | `skills/` | Registered through the plugin and symlinked into Codex |
| Subagents | `agents/` | Reusable specialists packaged with the plugin |
| Hooks | `hooks/hooks.json` | Codex hook source of truth; Claude hooks live in the plugin manifest |
| Agent orchestrator MCP | `mcp/agent-orchestrator/` | Bundled MCP server for staged agent coordination |
| Codex MCP config | `mcp/servers.json` | Mirrors the bundled MCP into `~/.codex/config.toml` |
| Rules | `rules/rules.md` | Injected into `~/.claude/CLAUDE.md` and `~/.agents/AGENTS.md` |
| Status line | `scripts/statusline.sh` | Shows git branch, model, context %, and rate limits |

## Skills

### Development workflow

Run these skills in order across any project, from raw idea to shipped feature. Each skill reads the documents the previous one wrote, so the chain is self-contained.

| Step | Skill | What it does |
|------|-------|--------------|
| 1 | `/ideate` | Research competitors and market viability on the web; decide whether to pursue the idea |
| 2 | `/product-plan` | Define audience, positioning, features, roadmap, and UX through a structured interview |
| 3 | `/dev-plan` | Decide architecture, stack, and generate a technical spec for every must-have feature |
| 4 | `/prototype` | Build throwaway code to answer a specific design question before committing to an approach |
| 5 | `/implement` | Classify features as HITL/AFK, then implement the current phase as parallel vertical slices |
| 6 | `/qa` | Build a feedback loop, test all acceptance criteria, fix simple failures, flag architectural gaps |
| 7 | `/update-docs` | Sync all documentation — internal and public — with the current state of the project |

Step 4 (`/prototype`) is optional — use it when a feature carries high technical uncertainty.
Steps 5–6 repeat for each phase of the roadmap.

### Starting mid-flow

If you have an existing project with scattered docs — a `docs/` folder, a `SPEC.md`, an `ARCHITECTURE.md`, notes spread across the repo — run `/migrate-docs` first. It finds everything, classifies it, and migrates it into the harness workflow in one pass.

If the project has code but no docs at all, skip `/ideate` and start with `/product-plan` — it reads the codebase first and reconstructs context from what's already built.

### Utilities

These can be used at any point in the workflow.

| Skill | What it does |
|-------|--------------|
| `/migrate-docs` | Discover all existing docs in the repo and migrate them to the harness structure |
| `/handoff` | Compact the current session state into a temp-file for the next agent or session |
| `/zoom-out` | Map all relevant modules and their callers in an unfamiliar area of code |

## Install

```bash
git clone git@github.com:RubenGlez/harness.git ~/workspace/harness
cd ~/workspace/harness
bash setup.sh           # full install (recommended)
bash setup.sh --custom  # pick which components to install
```

`setup.sh` handles everything without opening Claude Code or Codex:

- Symlinks the repo into `~/.claude/plugins/cache/` and registers it in `installed_plugins.json`
- Writes Codex hooks from `hooks/hooks.json` to `~/.codex/config.toml`
- Ships reusable subagents from `agents/` with the plugin
- Installs npm deps for the bundled MCP under `mcp/agent-orchestrator/package.json`
- Mirrors the bundled MCP into `~/.codex/config.toml` from `mcp/servers.json`
- Makes skills available in Claude through the plugin and symlinks them into `~/.codex/skills/`
- Configures the status line in `~/.claude/settings.json`

Safe to re-run; every step is idempotent.

## Update

```bash
git pull
bash setup.sh
```

Skills, subagents, and script edits are picked up immediately on the next session (the cache entry is a symlink to the repo). Re-running `setup.sh` is only needed when `hooks/hooks.json`, `mcp/servers.json`, `mcp/agent-orchestrator/package.json`, or `rules/rules.md` change.

## Uninstall

```bash
bash uninstall.sh
```

Reverses everything `setup.sh` did: removes the plugin, skill symlinks, Codex MCP config, rules, and status line config. Other plugins, skills, and config are never touched.

## Third-party tools

These aren't scripted because each has its own interactive setup flow. Install them manually on a new machine before or after running `setup.sh`.

### Skills

**Matt Pocock's skills** (`grill-me`, `improve-codebase-architecture`, `write-a-skill`)
```bash
npx skills@latest add mattpocock/skills
```

### MCPs

**Bundled agent orchestrator**, automation-friendly coordination for harness stages and git worktrees.
This MCP is installed with the plugin and wired automatically by `setup.sh`.
It stops on `partial` or `blocked` stage results so human review is required before continuing.

**Playwright**, browser automation and UI testing

```
/plugin marketplace add claude-plugins-official
/plugin install playwright@claude-plugins-official
```

**Argent**, iOS simulator and Android emulator control

Follow the install guide at [argent.tools](https://argent.tools), then run `argent init` to wire up the MCP in both Claude and Codex.

### Tools

**RTK**, token-saving proxy for Bash commands (60–90% reduction on shell ops)
```bash
brew install rtk
```

Then add the hook to `hooks/hooks.json` and run `bash setup.sh`.

---

## Acknowledgements

- **[Matt Pocock's skills](https://github.com/mattpocock/skills)**: several patterns in this repo are directly inspired by his work — the HITL/AFK classification and vertical slice model (`/implement`) come from `to-issues`; the feedback-loop-first approach and post-mortem (`/qa`) come from `diagnose`; the behavioral testing principle comes from `tdd`; the domain glossary pattern (`CONTEXT.md`) and ADR creation rules come from `grill-with-docs`; and the `/prototype`, `/handoff`, and `/zoom-out` skills are adapted from his originals.
- **[Andrej Karpathy's CLAUDE.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md)**: the behavioral guidelines in `rules/rules.md` (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution) are adapted from his work.
