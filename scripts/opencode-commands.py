#!/usr/bin/env python3
"""
Generates OpenCode slash commands that wrap harness skills.

Each skills/<name>/SKILL.md becomes ~/.config/opencode/commands/<name>.md.
The command template tells the agent to load the skill through the skill tool
and passes user input through $ARGUMENTS. Skills stay the source of truth;
commands are thin, regenerable wrappers.

Env vars (used by the smoke tests; unset in normal use = all skills):
  HARNESS_SKILLS   comma-separated skill dirs to include (unset = all, empty = none)
"""

import os
import re
import sys
from pathlib import Path

HARNESS_DIR = Path(sys.argv[1])
UNINSTALL = "--uninstall" in sys.argv

COMMANDS_DIR = Path(os.environ.get("OPENCODE_CONFIG_DIR") or Path.home() / ".config" / "opencode") / "commands"

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def skill_dirs():
    _env = os.environ.get("HARNESS_SKILLS")
    if _env is not None:
        allowed = {x for x in _env.split(",") if x}
    else:
        allowed = None
    out = []
    for skill_md in sorted(HARNESS_DIR.glob("skills/*/SKILL.md")):
        if "/deprecated/" in str(skill_md):
            continue
        name = skill_md.parent.name
        if allowed is not None and name not in allowed:
            continue
        if not NAME_RE.match(name):
            continue
        out.append((name, skill_md))
    return out


def parse_frontmatter(path: Path) -> dict:
    meta = {}
    lines = path.read_text().splitlines()
    if not lines or lines[0].strip() != "---":
        return meta
    for line in lines[1:]:
        if line.strip() == "---":
            break
        m = re.match(r"^(\w+):\s*(.*)$", line)
        if m:
            meta[m.group(1)] = m.group(2).strip().strip("'\"")
    return meta


def build_command(name: str, description: str) -> str:
    return (
        "---\n"
        f"description: {description}\n"
        "---\n"
        f"Use the skill tool to load the `{name}` skill, then follow it exactly.\n"
        "\n"
        "$ARGUMENTS\n"
    )


def run():
    if UNINSTALL:
        removed = False
        for name, _ in skill_dirs():
            target = COMMANDS_DIR / f"{name}.md"
            if target.exists():
                target.unlink()
                print(f"   removed /{name}")
                removed = True
        print("✓  Commands (OpenCode): removed" if removed else "✓  Commands (OpenCode): nothing to remove")
        return

    COMMANDS_DIR.mkdir(parents=True, exist_ok=True)
    for name, skill_md in skill_dirs():
        meta = parse_frontmatter(skill_md)
        description = meta.get("description") or f"Run the {name} harness skill"
        content = build_command(name, description)
        target = COMMANDS_DIR / f"{name}.md"
        if target.exists() and target.read_text() == content:
            continue
        target.write_text(content)
        print(f"   /{name}")
    print(f"✓  Commands → OpenCode ({COMMANDS_DIR})")


run()
