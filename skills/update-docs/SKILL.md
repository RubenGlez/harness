---
name: update-docs
description: Update all project documentation to reflect the current state of the codebase. Use after finishing a feature, refactor, or any meaningful change — or whenever docs feel stale.
---

# Update Docs

## Step 1: Build a current-state summary

Before writing anything, read everything.

**Git history**: `git log --oneline -20`, note which areas were touched.

**Existing docs**: read all files under `.harness/` and any root docs (README.md, DESIGN.md, CHANGELOG.md).

**Codebase**: scan key directories, check package manifests, note what's implemented, removed, or changed. Verify the project sync standard: `CLAUDE.md` should contain only `@AGENTS.md`, and `AGENTS.md` should contain only durable, agent-facing facts that are not reliably inferable from the repo itself.

**Reconcile phase status.** This skill is the owner of status consistency — no other skill cross-checks it. Phase state lives in three sources that drift independently: per-feature `Status:` lines in `.harness/engineering/features/`, phase markers in `.harness/product/roadmap.md`, and the latest `.harness/qa/report.md`. Compare them against each other and against the actual code:
- A feature marked `done` whose code isn't there (or vice versa) → fix the spec to match reality.
- A roadmap phase whose features are all `done` but is still marked planned → advance the roadmap marker.
- A `qa/report.md` listing outstanding failures for a feature still marked `done` → the spec is lying; reflect the failure.
Record each disagreement in the summary's "Stale docs" section so Subagent A corrects it.

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

Subagents A and B write different files — two subagents must never edit the same `.harness/` file (encrypted docs cannot line-merge).

**Subagent A** updates internal docs under `.harness/`: `product.md`, `roadmap.md`, `competitors.md`, `ux.md`, `CONTEXT.md`, `architecture.md`, `implementation-plan.md`, `adr/`, `features/[slug].md`, `qa/report.md`.

Only update a file if the summary shows it's stale. Do not touch accurate files. Never link to `.harness/` from public docs.

**Subagent B** updates public docs: `README.md`, `DESIGN.md`, `CHANGELOG.md`, `AGENTS.md`.

Keep public docs strictly separated from internal content — no `.harness/` links, no internal strategy, no implementation details.

See [REFERENCE.md](REFERENCE.md) for the detailed rules and content guidelines for each file.

## Step 3: Refresh the doc index and commit

After both subagents finish, run `doctier agents --write` to refresh the managed doc index in AGENTS.md (the block between `<!-- doctier:begin -->` and `<!-- doctier:end -->`). Then commit everything — worktrees and future sessions only see committed `.harness/` content:

```bash
git add .harness AGENTS.md README.md DESIGN.md CHANGELOG.md CLAUDE.md 2>/dev/null
git commit -m "docs: sync with current state"
```

## Step 4: Confirm

Report:
- Every file updated, with one line on what changed
- Every file left untouched and why
- Confirmation that the doc index refresh and the commit landed
- Any doc gaps this run couldn't fill

Recommend next step: release the phase with /ship if it's user-ready, or start the next phase with /implement.
