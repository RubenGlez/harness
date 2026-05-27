# Harness

Personal Claude Code plugin — custom skills and a status line for the terminal.

## What's included

| Component | File | Purpose |
|-----------|------|---------|
| Script | `scripts/statusline.sh` | Status line showing git branch, model, context %, and rate limits |
| Skills | `skills/` | Custom skills, added as needed |

## Setup

### 1. Push to GitHub

The plugin is installed from a GitHub repo. Push this repo (can be private):

```bash
git remote add origin git@github.com:RubenGlez/harness.git
git push -u origin main
```

### 2. Register the marketplace

Add the repo as a known marketplace in `~/.claude/settings.json`:

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

### 3. Install the plugin

In any Claude Code session:

```
/plugin install harness@harness
```

### 4. Enable the status line

The status line script needs to be wired up in `~/.claude/settings.json`. After installing, find the plugin's cache path:

```bash
ls ~/.claude/plugins/cache/harness/harness/
```

Then update `settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/plugins/cache/harness/harness/<version>/scripts/statusline.sh"
  }
}
```

Or, since the repo is local, point directly at the source:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash /Users/ruben/workspace/harness/scripts/statusline.sh"
  }
}
```

## Adding skills

Create `skills/<name>/SKILL.md` and push. Then update the plugin:

```
/plugin update harness@harness
```

See `CLAUDE.md` for the skill frontmatter format.
