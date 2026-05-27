# Harness

Personal Claude Code plugin — custom skills and a status line for the terminal.

## What's included

| Component | File | Purpose |
|-----------|------|---------|
| Script | `scripts/statusline.sh` | Status line showing git branch, model, context %, and rate limits |
| Skills | `skills/` | Custom skills, added as needed |

## Setup

### 1. Clone the repo

```bash
git clone git@github.com:RubenGlez/harness.git ~/workspace/harness
cd ~/workspace/harness
```

### 2. Run the setup script

```bash
bash setup.sh
```

This configures everything in `~/.claude/settings.json` automatically. It's idempotent — safe to re-run after pulling updates.

### 3. Register as a plugin marketplace (optional)

If you want to install the plugin into Claude Code's plugin system, add this to `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "harness": {
      "source": {
        "source": "github",
        "repo": "RubenGlez/harness"
      }
    }
  }
}
```

Then in any Claude Code session:

```
/plugin install harness@harness
```

### 4. Restart Claude Code

Changes to `settings.json` take effect on the next session.

## Adding skills

Create `skills/<name>/SKILL.md` and push. Then update the plugin:

```
/plugin update harness@harness
```

See `CLAUDE.md` for the skill frontmatter format.
