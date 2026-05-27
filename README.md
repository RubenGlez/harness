# Harness

Personal Claude Code and Codex plugin — custom skills, hooks, MCP servers, and a status line for the terminal.

## What's included

| Component | File | Purpose |
|-----------|------|---------|
| Skills | `skills/` | Shared across Claude and Codex via symlinks |
| Hooks | `hooks/hooks.json` | Source of truth — synced to Claude (JSON) and Codex (TOML) |
| MCPs | `mcp/servers.json` | Source of truth — synced to Claude (JSON) and Codex (TOML) |
| Rules | `rules/rules.md` | Injected into `~/.claude/CLAUDE.md` and `~/.agents/AGENTS.md` |
| Status line | `scripts/statusline.sh` | Shows git branch, model, context %, and rate limits |

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
- Writes MCP servers from `mcp/servers.json` to `~/.claude/settings.json` and `~/.codex/config.toml`
- Symlinks each skill to `~/.claude/skills/` and `~/.codex/skills/`
- Configures the status line in `~/.claude/settings.json`

Safe to re-run — every step is idempotent.

## Update

```bash
git pull
bash setup.sh
```

Skills and script edits are picked up immediately on the next session (the cache entry is a symlink to the repo). Re-running `setup.sh` is only needed when `hooks/hooks.json`, `mcp/servers.json`, or `plugin.json` change.

## Uninstall

```bash
bash uninstall.sh
```

Reverses everything `setup.sh` did — removes the plugin, skill symlinks, hooks, MCPs, and status line config. Other plugins, skills, and config are never touched.

## Third-party dependencies

These aren't scripted because each has its own interactive setup flow. Install them manually on a new machine before or after running `setup.sh`.

### Skills

**Matt Pocock's skills** — `grill-me`, `improve-codebase-architecture`, `write-a-skill`
```bash
npx skills@latest add mattpocock/skills
```

### MCPs

**Context7** — up-to-date library and framework docs fetched inline. Configured automatically via `mcp/servers.json`.

For higher rate limits, get a free API key at [context7.com/dashboard](https://context7.com/dashboard) and export it in your shell profile:
```bash
export CONTEXT7_API_KEY=your-key-here
```
The MCP server picks it up automatically — no config change needed.

**Playwright** — browser automation and UI testing

```
/plugin marketplace add claude-plugins-official
/plugin install playwright@claude-plugins-official
```

**Argent** — iOS simulator and Android emulator control

Follow the install guide at [argent.tools](https://argent.tools), then run `argent init` to wire up the MCP in both Claude and Codex.

### Tools

**RTK** — token-saving proxy for Bash commands (60–90% reduction on shell ops)
```bash
brew install rtk
```

Then add the hook to `hooks/hooks.json` and run `bash setup.sh`.

---

## Acknowledgements

- **[Matt Pocock's skills](https://github.com/mattpocock/skills)** — `product-fit` inspired by `grill-me`; `product-to-docs` inspired by `to-prd`
- **[Andrej Karpathy's CLAUDE.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md)** — the behavioral guidelines in `rules/rules.md` (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution) are adapted from his work
