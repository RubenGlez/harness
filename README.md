# Harness

Personal Claude Code plugin — custom skills and a status line for the terminal.

## What's included

| Component | File | Purpose |
|-----------|------|---------|
| Script | `scripts/statusline.sh` | Status line showing git branch, model, context %, and rate limits |
| Skills | `skills/` | Custom skills, added as needed |

## Setup

```bash
git clone git@github.com:RubenGlez/harness.git ~/workspace/harness
cd ~/workspace/harness
bash setup.sh
```

The script handles everything without opening Claude Code:

- Symlinks the repo into `~/.claude/plugins/cache/` so the plugin is live immediately
- Registers it in `installed_plugins.json` and enables it in `settings.json`
- Configures the status line

It's idempotent — safe to re-run after pulling updates.

## Updating

```bash
git pull
bash setup.sh   # only needed if the version in plugin.json changed
```

Because the cache entry is a symlink to the repo, any file changes (new skills, script edits) are picked up immediately on the next Claude Code session without re-running setup.

## Adding skills

Create `skills/<name>/SKILL.md` and push. Then update the plugin:

```
/plugin update harness@harness
```

See `CLAUDE.md` for the skill frontmatter format.
