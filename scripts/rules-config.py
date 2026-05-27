#!/usr/bin/env python3
"""
Injects or removes harness-managed rule blocks in global markdown files.
Manages a clearly marked harness block — everything outside it is untouched.
Prompts for permission before writing to a file for the first time.
"""

import re
import sys
from pathlib import Path

HARNESS_DIR = Path(sys.argv[1])
UNINSTALL = "--uninstall" in sys.argv

START = "<!-- harness:start -->"
END   = "<!-- harness:end -->"

TARGETS = [
    (
        HARNESS_DIR / "rules" / "claude.md",
        Path.home() / ".claude" / "CLAUDE.md",
        "CLAUDE.md",
    ),
    (
        HARNESS_DIR / "rules" / "agents.md",
        Path.home() / ".agents" / "AGENTS.md",
        "AGENTS.md",
    ),
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def read_file(path: Path) -> str:
    try:
        return path.read_text()
    except FileNotFoundError:
        return ""


def build_block(rules_path: Path) -> str:
    content = rules_path.read_text().strip()
    return f"{START}\n{content}\n{END}"


def has_block(text: str) -> bool:
    return START in text


def get_existing_block(text: str) -> str:
    m = re.search(r"<!-- harness:start -->.*?<!-- harness:end -->", text, re.DOTALL)
    return m.group(0) if m else ""


def replace_block(text: str, new_block: str) -> str:
    return re.sub(
        r"<!-- harness:start -->.*?<!-- harness:end -->",
        new_block,
        text,
        flags=re.DOTALL,
    )


def strip_block(text: str) -> str:
    return re.sub(
        r"\n?<!-- harness:start -->.*?<!-- harness:end -->\n?",
        "",
        text,
        flags=re.DOTALL,
    )


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


# ── Install ────────────────────────────────────────────────────────────────────

def process(rules_path: Path, dest: Path, label: str) -> None:
    if not rules_path.exists():
        return

    block = build_block(rules_path)
    existing = read_file(dest)

    if has_block(existing):
        if get_existing_block(existing) == block:
            print(f"✓  Rules ({label}): already up to date")
        else:
            write_file(dest, replace_block(existing, block))
            print(f"✓  Rules ({label}): updated")
        return

    # No block yet — show content and ask permission
    rules_content = rules_path.read_text().strip()
    print(f"\n   Rules → {dest}:")
    print("   " + "─" * 50)
    for line in rules_content.splitlines():
        print(f"   {line}")
    print("   " + "─" * 50)

    action = "Replace" if existing.strip() else "Write"
    try:
        reply = input(f"   {action} {label} with this block? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        reply = ""

    if reply == "y":
        # Replace the entire file — avoids duplicating content that's being
        # migrated into harness. Subsequent runs only update the block itself,
        # so any content the user adds outside the block is preserved from here on.
        write_file(dest, block + "\n")
        print(f"✓  Rules → {dest}")
    else:
        print("   Skipped")


# ── Uninstall ──────────────────────────────────────────────────────────────────

def unprocess(dest: Path, label: str) -> None:
    existing = read_file(dest)
    if not has_block(existing):
        print(f"✓  Rules ({label}): nothing to remove")
        return
    write_file(dest, strip_block(existing))
    print(f"✓  Rules ({label}): removed")


# ── Run ────────────────────────────────────────────────────────────────────────

if UNINSTALL:
    for _, dest, label in TARGETS:
        unprocess(dest, label)
else:
    for rules, dest, label in TARGETS:
        process(rules, dest, label)
