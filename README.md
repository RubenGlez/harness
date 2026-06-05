# Harness

Personal Claude Code and Codex plugin: a complete development workflow in skills, reusable subagents, custom hooks, a bundled AFK agent orchestrator MCP, and a terminal status line. Recommended third-party tools are listed below.

## What's included

| Component | File | Purpose |
|-----------|------|---------|
| Skills | `skills/` | Registered in Claude via plugin manifest; symlinked into Codex |
| Subagents | `agents/` | Reusable specialists packaged with the plugin |
| Hooks | `hooks/hooks.json` | Source of truth, synced to Claude (JSON) and Codex (TOML) |
| Bundled MCPs | `mcp/` | Internal MCP servers plus their npm deps, synced to Claude and Codex |
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

If you have an existing project with scattered docs — a `docs/` folder, a `SPEC.md`, an `ARCHITECTURE.md`, notes spread across the repo — run `/migrate-docs` first. It finds everything, classifies it, and migrates it to the harness structure in one pass.

If the project has code but no docs at all, skip `/ideate` and start with `/product-plan` — it reads the codebase first and reconstructs context from what's already built.

### Utilities

These can be used at any point in the workflow.

| Skill | What it does |
|-------|--------------|
| `/migrate-docs` | Discover all existing docs in the repo and migrate them to the harness structure |
| `/handoff` | Compact the current session state into a temp-file for the next agent or session |
| `/zoom-out` | Map all relevant modules and their callers in an unfamiliar area of code |

## Document structure

Skills write to two locations in every project repo:

**Private** (`.harness/`, gitignored) — internal docs consumed by agents and never published:

```
.harness/
  product/
    idea.md          # viability research and verdict
    product.md       # vision, audience, positioning
    roadmap.md       # prioritised feature backlog
    competitors.md   # competitive analysis
    ux.md            # core workflows and design direction
    CONTEXT.md       # domain glossary — canonical vocabulary for all code and docs
  engineering/
    architecture.md          # stack, components, data flow
    implementation-plan.md   # phased task list
    features/[slug].md       # one technical spec per must-have feature
  adr/
    NNNN-[slug].md   # architectural decisions
  qa/
    report.md        # QA results and architectural gaps
```

**Public** (repo root, committed) — visible on GitHub:

```
README.md
CHANGELOG.md
CONTRIBUTION.md
LICENSE
DESIGN.md   # Google DESIGN.md format — design tokens for UI projects
```

Private files are never linked from public documents.

## Install

```bash
git clone git@github.com:RubenGlez/harness.git ~/workspace/harness
cd ~/workspace/harness
bash setup.sh           # full install (recommended)
bash setup.sh --custom  # pick which components to install
```

`setup.sh` handles everything without opening Claude Code or Codex:

- Symlinks the repo into `~/.claude/plugins/cache/` and registers it in `installed_plugins.json`
- Writes hooks from `hooks/hooks.json` to `~/.claude/settings.json` and `~/.codex/config.toml`
- Ships reusable subagents from `agents/` with the plugin
- Installs npm deps for bundled MCPs under `mcp/*/package.json`
- Uses `mcp/servers.json` as the source of truth for optional third-party MCP installs in local config
- Registers skills in Claude via `plugin.json`; symlinks each skill to `~/.codex/skills/`
- Configures the status line in `~/.claude/settings.json`

Safe to re-run; every step is idempotent.

## Update

```bash
git pull
bash setup.sh
```

Skills, subagents, and script edits are picked up immediately on the next session (the cache entry is a symlink to the repo). Re-running `setup.sh` is only needed when `hooks/hooks.json`, `mcp/servers.json`, `mcp/*/package.json`, or `plugin.json` change.

## Uninstall

```bash
bash uninstall.sh
```

Reverses everything `setup.sh` did: removes the plugin, skill symlinks, hooks, MCPs, and status line config. Other plugins, skills, and config are never touched.

## Third-party tools

These aren't scripted because each has its own interactive setup flow. Install them manually on a new machine before or after running `setup.sh`.

### Skills

**Matt Pocock's skills** (`grill-me`, `improve-codebase-architecture`, `write-a-skill`)
```bash
npx skills@latest add mattpocock/skills
```

### MCPs

**Bundled**, automation-friendly agent orchestration for harness stages and git worktrees.
This MCP is installed with the plugin and wired automatically by `setup.sh`.
It stops on `partial` or `blocked` stage results so human review is required before continuing.

**Context7**, up-to-date library and framework docs fetched inline, available as an optional local install from `mcp/servers.json`.

For higher rate limits, get a free API key at [context7.com/dashboard](https://context7.com/dashboard) and export it in your shell profile:
```bash
export CONTEXT7_API_KEY=your-key-here
```
The MCP server picks it up automatically; no config change needed.

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
