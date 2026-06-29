---
name: update-docs
description: Update all project documentation to reflect the current state of the codebase. Use after finishing a feature, refactor, or any meaningful change — or whenever docs feel stale.
---

# Update Docs

## Step 1: Build a current-state summary

Before writing anything, read everything.

**Git history**: `git log --oneline -20`, note which areas were touched.

**Existing docs**: read all files under `.harness/` (skip `.harness/.base/` — it is a snapshot, not live docs) and any root docs (README.md, DESIGN.md, CHANGELOG.md).

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

**Subagent A** updates internal docs under `.harness/`: `product.md`, `roadmap.md`, `competitors.md`, `ux.md`, `CONTEXT.md`, `architecture.md`, `implementation-plan.md`, `adr/`, `features/[slug].md`, `qa/report.md`.

Only update a file if the summary shows it's stale. Do not touch accurate files. Never link to `.harness/` from public docs.

**Subagent B** updates public docs: `README.md`, `DESIGN.md`, `CHANGELOG.md`, `AGENTS.md`.

Keep public docs strictly separated from internal content — no `.harness/` links, no internal strategy, no implementation details.

See [REFERENCE.md](REFERENCE.md) for the detailed rules and content guidelines for each file.

## Step 3: Promote to main (only when running in a worktree)

If this session is in a linked worktree, its `.harness/` is a seeded copy of main's, with a pristine `.harness/.base/` captured at seed time. Subagent A just updated the worktree copy — those edits are **not** in main yet, and they should land only if you decide this branch's docs belong there (a throwaway/POC worktree should leave main untouched).

Detect the worktree and reconcile against main using `.base/` as the merge base. See [REFERENCE.md](REFERENCE.md) for the exact procedure. Then **ask the user before promoting**. If they decline, stop — main stays clean. If they accept, write the reconciled docs into the main checkout's `.harness/`.

In the main checkout, skip this step entirely.

## Step 4: Confirm

After both subagents finish, report:
- Every file updated, with one line on what changed
- Every file left untouched and why
- Whether worktree docs were promoted to main (or skipped, and why)
- Any doc gaps this run couldn't fill

Recommend next step: release the phase with /ship if it's user-ready, or start the next phase with /implement.
