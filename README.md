# Harness

Personal Claude Code plugin — Argent mobile workflow, environment inspection, RTK token savings, and a custom status line.

## What's included

| Component | File | Purpose |
|-----------|------|---------|
| Agent | `agents/argent-environment-inspector.md` | Inspects any mobile project and returns a structured JSON environment snapshot |
| Rule | `rules/argent.md` | Always-on guidance for Argent MCP tool usage (simulators, gestures, skill routing) |
| Hook | `hooks/hooks.json` | Runs `rtk hook claude` before every Bash call to strip noise and save tokens |
| Script | `scripts/statusline.sh` | Status line showing git branch, model, context %, and rate limits |

## Install

```bash
# Install locally (path source)
/plugin install file:///Users/ruben/workspace/harness
```

After installing, update `settings.json` to point the status line at the plugin script:

```json
"statusLine": {
  "type": "command",
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh"
}
```

> `${CLAUDE_PLUGIN_ROOT}` resolves to the installed plugin cache path. Until you know that path, keep pointing at the original `~/.claude/statusline-command.sh`.

## Requirements

- [RTK](https://github.com/rtk-rs/rtk) — the `rtk` binary must be on PATH for the hook to work
- [Argent](https://argent.dev) — MCP server configured in Claude Code for the mobile skills and rules to make sense

## Adding skills

Create `skills/<name>/SKILL.md` and reload the plugin. See `CLAUDE.md` for the full guide.
