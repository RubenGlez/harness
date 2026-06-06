---
name: handoff
stage_order: 8
description: Compact the current conversation into a handoff document for the next agent or session. Saves to the OS temp directory — never to the repo. Includes current state, artifacts written, decisions made, and the suggested next skill. Use at the end of any phase to prepare a clean starting point for the next session.
---

# Handoff

## What to produce

A single markdown document that gives a fresh agent everything it needs to pick up exactly where this session left off — without reading this conversation.

Reference, don't duplicate. Do not re-paste content that already exists in `.harness/` files or other artifacts — link to them instead.

## Step 1: Gather what exists

Identify:
- Every `.harness/` file written or updated this session (path + one-line summary of what changed)
- Every code file created or modified (path + what changed)
- Any public root files updated (README.md, DESIGN.md, CHANGELOG.md)
- Any outstanding issues or blockers
- Any decisions made in conversation that are NOT yet captured in `.harness/adr/`

## Step 2: Write the handoff document

Save to the OS temp directory — never to the repo:
- Resolve path: `$TMPDIR` → `/tmp` → `%TEMP%` (Windows)
- Filename: `handoff-[YYYY-MM-DD-HHmm].md`

```
# Handoff — [YYYY-MM-DD HH:mm]

## Context
One paragraph: what this project is, where it sits in the development lifecycle, and what this session accomplished.

## What was done this session
- [artifact or action] — [one-line summary]

## Current state
- **Phase**: ideation / product / engineering / implementation / qa / docs
- **Features done**: [list, or "none yet"]
- **Features in progress**: [list, or "none"]
- **Blockers**: [list, or "none"]

## Key decisions made in conversation
Only decisions NOT already in .harness/adr/. Omit ephemeral reasoning ("chose X because it was faster today") — only capture things that would surprise a future agent.

## Artifacts to read first
In priority order for the next agent:
1. [path] — [why it matters]
2. ...

## Suggested next skill
/[skill-name] — [one sentence on what it will do and why now]

## Notes for next agent
Anything surprising, any implicit constraints, or any context that doesn't emerge from reading the artifacts alone.
```

Omit any section that has nothing to say. Redact secrets, API keys, and PII before writing.

## Step 3: Tell the user

Output the full absolute path to the handoff file. If the user wants to start a new session, they can paste the file contents as the first message.
