# Harness

Personal Claude Code and Codex plugin — custom skills, hooks, MCP servers, and a status line for the terminal.

## What's included

| Component | File | Purpose |
|-----------|------|---------|
| Skills | `skills/` | Shared across Claude and Codex via symlinks |
| Hooks | `hooks/hooks.json` | Source of truth — synced to Claude (JSON) and Codex (TOML) |
| MCPs | `mcp/servers.json` | Source of truth — synced to Claude (JSON) and Codex (TOML) |
| Status line | `scripts/statusline.sh` | Shows git branch, model, context %, and rate limits |

## Install

```bash
git clone git@github.com:RubenGlez/harness.git ~/workspace/harness
cd ~/workspace/harness
bash setup.sh
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

## Adding skills

1. Create `skills/<name>/SKILL.md`
2. Add the path to `.claude-plugin/plugin.json` under `"skills"`
3. Run `bash setup.sh` to symlink it into Claude and Codex
4. Push

See `CLAUDE.md` for the skill frontmatter format.

## Adding hooks

Edit `hooks/hooks.json` and run `bash setup.sh`. Example:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "your-cmd" }]
      }
    ]
  }
}
```

## Adding MCP servers

Edit `mcp/servers.json` and run `bash setup.sh`. Example:

```json
{
  "my-server": {
    "command": "npx",
    "args": ["-y", "my-mcp@latest"]
  }
}
```
