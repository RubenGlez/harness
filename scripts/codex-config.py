#!/usr/bin/env python3
"""
Syncs hooks and MCP servers from harness config into ~/.codex/config.toml.
Manages a clearly marked harness block — everything outside it is untouched.
"""

import json
import re
import sys
from pathlib import Path

HARNESS_DIR = Path(sys.argv[1])
UNINSTALL = "--uninstall" in sys.argv
CODEX_CONFIG = Path.home() / ".codex" / "config.toml"

START = "# ── harness:start ───────────────────────────────────────────────────────────"
END   = "# ── harness:end ─────────────────────────────────────────────────────────────"


# ── TOML helpers ───────────────────────────────────────────────────────────────

def toml_value(v):
    if isinstance(v, str):
        return f'"{v}"'
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "[" + ", ".join(toml_value(x) for x in v) + "]"
    return f'"{v}"'


def hooks_to_toml(hooks: dict) -> str:
    lines = []
    for event, groups in hooks.items():
        for group in groups:
            lines.append(f"[[hooks.{event}]]")
            if "matcher" in group:
                lines.append(f'matcher = {toml_value(group["matcher"])}')
            for hook in group.get("hooks", []):
                lines.append(f"[[hooks.{event}.hooks]]")
                for k, v in hook.items():
                    lines.append(f"{k} = {toml_value(v)}")
            lines.append("")
    return "\n".join(lines)


def mcps_to_toml(servers: dict) -> str:
    lines = []
    for name, cfg in servers.items():
        lines.append(f"[mcp_servers.{name}]")
        for k, v in cfg.items():
            if isinstance(v, dict):
                for dk, dv in v.items():
                    lines.append(f"[mcp_servers.{name}.{k}]")
                    lines.append(f"{dk} = {toml_value(dv)}")
            else:
                lines.append(f"{k} = {toml_value(v)}")
        lines.append("")
    return "\n".join(lines)


# ── Uninstall ──────────────────────────────────────────────────────────────────

def remove_harness_block():
    if not CODEX_CONFIG.exists():
        print("✓  Codex: nothing to remove")
        return
    text = CODEX_CONFIG.read_text()
    if START not in text:
        print("✓  Codex: nothing to remove")
        return
    pattern = r"\n?" + re.escape(START) + r".*?" + re.escape(END) + r"\n?"
    CODEX_CONFIG.write_text(re.sub(pattern, "", text, flags=re.DOTALL))
    print("✓  Removed harness block from ~/.codex/config.toml")

if UNINSTALL:
    remove_harness_block()
    sys.exit(0)

# ── Load sources ───────────────────────────────────────────────────────────────

hooks_file = HARNESS_DIR / "hooks" / "hooks.json"
mcps_file = HARNESS_DIR / "mcp" / "servers.json"

hooks = {}
if hooks_file.exists():
    raw_text = hooks_file.read_text()
    raw = json.loads(raw_text).get("hooks", {})
    hooks = {k: v for k, v in raw.items() if v}  # drop empty arrays

servers = {}
if mcps_file.exists():
    servers = json.loads(mcps_file.read_text())

# ── Nothing to do ──────────────────────────────────────────────────────────────

if not hooks and not servers:
    # Remove stale harness block if present
    if CODEX_CONFIG.exists():
        text = CODEX_CONFIG.read_text()
        if START in text:
            pattern = r"\n?" + re.escape(START) + r".*?" + re.escape(END) + r"\n?"
            CODEX_CONFIG.write_text(re.sub(pattern, "", text, flags=re.DOTALL))
    print("✓  Codex: nothing to configure")
    sys.exit(0)

# ── Generate block ─────────────────────────────────────────────────────────────

parts = []
if hooks:
    parts.append(hooks_to_toml(hooks))
if servers:
    parts.append(mcps_to_toml(servers))

block_content = "\n".join(parts).strip()
new_block = f"{START}\n{block_content}\n{END}"

# ── Write ──────────────────────────────────────────────────────────────────────

CODEX_CONFIG.parent.mkdir(parents=True, exist_ok=True)
existing = CODEX_CONFIG.read_text() if CODEX_CONFIG.exists() else ""

if START in existing:
    pattern = re.escape(START) + r".*?" + re.escape(END)
    new_content = re.sub(pattern, new_block, existing, flags=re.DOTALL)
else:
    sep = "" if existing.endswith("\n") or not existing else "\n"
    new_content = existing + sep + "\n" + new_block + "\n"

CODEX_CONFIG.write_text(new_content)
print("✓  Codex → ~/.codex/config.toml")
