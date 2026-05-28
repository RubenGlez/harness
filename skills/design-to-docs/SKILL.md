---
name: design-to-docs
description: Turn the current conversation context into an ADR after a /design-fit session. Writes docs/adr/NNNN-slug.md with context, decision, and consequences. Use when the user wants to capture engineering decisions as docs, says "write this up", "save this", or has just finished a design-fit session.
---

# Design to Docs

Do NOT re-interview the user. Synthesize what you already know from the conversation.

## Step 1: Read the repo

Before writing anything:

- Scan `docs/adr/` for existing ADRs to determine the next sequence number (0001 if none exist)
- Read existing ADRs only if needed to avoid duplicating a decision that's already recorded

All files go under `docs/adr/`. Create the directory if it doesn't exist.

## Step 2: Extract the decision

From the conversation, pull out:

- **Context** — what problem or situation prompted this decision; what constraints existed
- **Options considered** — the alternatives that were on the table
- **Decision** — what was chosen and the key reason why
- **Consequences** — what becomes easier, what becomes harder, what is now off the table

If the conversation didn't cover a section, omit it rather than inventing content.

## Step 3: Write the ADR

File name: `docs/adr/NNNN-short-slug.md` where `NNNN` is zero-padded (e.g. `0001`).

Use this structure:

```
# NNNN — [Short title: what was decided]

**Status**: accepted

## Context

What situation prompted this decision. Key constraints or forces at play.

## Options considered

- **Option A** — one-line summary, key tradeoff
- **Option B** — one-line summary, key tradeoff

## Decision

What was chosen and why. One short paragraph.

## Consequences

What this makes easier. What this makes harder or forecloses.
```

Keep each section tight. An ADR should be readable in under two minutes.

## Step 4: Confirm

After writing, show the file path and a one-line summary of the decision captured.
