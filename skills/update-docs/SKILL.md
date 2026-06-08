---
name: update-docs
description: Update all project documentation to reflect the current state of the codebase. Use after finishing a feature, refactor, or any meaningful change — or whenever docs feel stale.
---

# Update Docs

## Step 1: Build a current-state summary

Before writing anything, read everything.

**Git history**: `git log --oneline -20`, note which areas were touched.

**Existing docs**: read all files under `.harness/` and any root docs (README.md, DESIGN.md, CHANGELOG.md, CONTRIBUTION.md).

**Codebase**: scan key directories, check package manifests, note what's implemented, removed, or changed. Verify the project sync standard: `CLAUDE.md` should contain only `@AGENTS.md`, and `AGENTS.md` should be nearly empty — only undiscoverable, globally-relevant facts.

Synthesize a **current-state summary** (subagents receive this verbatim):

```
## What the product is now
[One paragraph: what it does, who it's for, current state]

## Recent changes not yet in docs
- [change] — [which docs this affects]

## Stale docs
- [file path] — [what's outdated and why]

## Accurate docs (do not touch)
- [file path] — [why it's still current]

## Missing docs
- [file path that should exist but doesn't, and why]
```

## Step 2: Spawn two subagents in parallel

Pass the full current-state summary to each — they cannot read the conversation or codebase themselves.

**Subagent A** updates internal docs under `.harness/`: `product.md`, `roadmap.md`, `competitors.md`, `ux.md`, `CONTEXT.md`, `architecture.md`, `implementation-plan.md`, `adr/`, `features/[slug].md`, `qa/report.md`.

Only update a file if the summary shows it's stale. Do not touch accurate files. Never link to `.harness/` from public docs.

**Subagent B** updates public docs: `README.md`, `DESIGN.md`, `CHANGELOG.md`, `CONTRIBUTION.md`, `AGENTS.md`.

Keep public docs strictly separated from internal content — no `.harness/` links, no internal strategy, no implementation details.

See [REFERENCE.md](REFERENCE.md) for the detailed rules and content guidelines for each file.

## Step 3: Confirm

After both subagents finish, report:
- Every file updated, with one line on what changed
- Every file left untouched and why
- Any doc gaps this run couldn't fill

Recommend next step: start the next phase with /implement, or close the current milestone.
