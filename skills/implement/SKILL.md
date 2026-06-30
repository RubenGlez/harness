---
name: implement
description: Classify planned features as autonomous or human-approval-required, then implement the current phase as parallel vertical slices — one subagent per feature. Use after dev-plan (and optionally prototype) has produced complete feature specs.
---

# Implement

## Step 1: Read the context

Read everything. Subagents start with no conversation context but have full repo access — your job is to orient them with the right pointers, not to transcribe files into their prompts.

**Internal docs**
- `.harness/engineering/architecture.md` — stack, components, data flow, constraints
- `.harness/engineering/implementation-plan.md` — phases and task ordering
- `.harness/engineering/features/` — all feature spec files (read every one)
- `.harness/adr/` — architectural decisions that constrain implementation
- `.harness/product/CONTEXT.md` — domain vocabulary (use these terms exactly in all code)

**Codebase**
- `AGENTS.md` — conventions, naming, patterns, do-not-edit files
- `README.md` — public description, install/run instructions
- Scan key directories: identify what files exist, what each does, what's absent
- Check `package.json` / `pyproject.toml` / `go.mod` — dependencies and scripts

Build a dependency map:
- Which features are `planned`?
- Which phase is current — the lowest phase number with `planned` features?
- Within the current phase, are any features dependent on others in the same phase?

If there is a conflict between `implementation-plan.md` and a feature spec, the feature spec takes precedence — it is the authoritative technical reference. Use `implementation-plan.md` only for phase ordering and task dependencies.

## Step 2: Classify features as HITL or AFK

Before implementing anything, classify each `planned` feature in the current phase:

**AFK** (can be implemented autonomously) — ALL must be true:
- The feature spec has complete, verifiable acceptance criteria
- The architecture and tech choices are fully defined in `architecture.md`
- No security, authentication, or authorisation decisions remain open
- No irreversible data migrations with loss risk
- No external API contracts that affect downstream consumers

**HITL** (needs human approval before proceeding) — ANY one is sufficient:
- Architectural decisions not resolved in `architecture.md` or ADRs
- Security, auth, or data-loss risk
- Acceptance criteria are vague or missing
- External contract changes (public API, database schema used by other systems)
- Significant design ambiguity that a spec gap would leave the agent to guess on

For each HITL feature: state the specific question that needs answering before implementation can proceed. Do not implement HITL features — surface the question to the user and wait for resolution.

## Step 3: Confirm scope with the user

Present:
- Current phase name and number
- AFK features you will implement (parallel)
- HITL features with their blocking question
- Any sequencing constraints within the AFK batch

Example:
> "Phase 1 — Foundation:
> - **AFK (parallel)**: user-authentication, project-creation
> - **HITL — blocked**: database-schema → Question: the spec says 'soft delete', but the architecture doc says 'hard delete'. Which applies here?
>
> I'll implement the AFK features in parallel. The database-schema feature needs your answer first. Proceed?"

Wait for confirmation. If HITL features have blocking questions, wait for answers before continuing.

**Persist every answer before implementing.** A HITL resolution given in chat is not durable — if it stays in the conversation, next session re-reads the same vague spec and re-asks the same question, and the subagent (which never sees this conversation) builds against the old spec. So before a resolved feature moves into the AFK batch, write the decision into the doc that owns it, in your own checkout:
- Vague or missing acceptance criterion → patch the criterion in `.harness/engineering/features/[slug].md`.
- Architectural or stack choice → update `.harness/engineering/architecture.md`, and open an ADR in `.harness/adr/` if it constrains future work.
- Security / auth / data decision → record it in the feature spec and, if cross-cutting, an ADR.

Only after the resolution is on disk does the feature become AFK. The subagent then receives the corrected spec in its prompt (Step 4), not the conversation.

## Step 4: Implement as vertical slices

Each agent implements ONE feature end-to-end through all layers — not one layer across all features.

A vertical slice means: from the user-facing entry point (UI interaction, CLI command, API endpoint) all the way through to storage, for this feature only. The agent implements exactly what this feature needs at each layer — not shared infrastructure, not future-proofing, not refactors.

This ensures each feature is independently demoable and verifiable the moment the agent finishes.

Subagent worktrees are created under `.claude/worktrees/`. Before spawning, make sure that path is gitignored (`grep -qxF '.claude/worktrees/' .gitignore || echo '.claude/worktrees/' >> .gitignore`) so an interrupted run that skips the Step 7 cleanup can't leave untracked worktrees that get committed by a later `git add`.

### For each AFK feature, spawn one subagent

See [REFERENCE.md](REFERENCE.md) for the prompt structure: the feature spec pasted in full, paths to the shared context docs, a short codebase orientation, and the implementation instructions.

### If features within the phase depend on each other

Implement blocking features first (sequentially), then run the remaining independent features in parallel.

## Step 5: Merge

Subagents run in worktrees that have no `.harness/`, so they report their results instead of editing it (see [REFERENCE.md](REFERENCE.md)). You are the only writer of `.harness/`.

Slices are meant to be independent, but any two features that touched a shared seam (router, schema, `package.json`, config, DI wiring) will collide on merge. Merge one branch at a time so each conflict is attributable:

```bash
git merge <worktree-branch> --no-edit   # repeat, one branch at a time
```

**If a merge conflicts**, resolve it so both features' intent survives — never blindly take one side, and never drop a sibling's change to make the conflict go away. The common cases:
- Shared list/registry (routes, exports, schema fields): keep both additions.
- Same line changed two ways: re-read both feature specs to decide the correct combined behavior.
- If you can't resolve confidently, `git merge --abort`, leave that feature unmerged, and mark it `blocked` with the conflict as the reason. Do not guess.

## Step 6: Integration check

Each slice was validated alone, against static checks only. The merged tree has never been exercised. Before writing anything back, run the project's static checks on the integrated tree (typecheck, build, lint — the same commands subagents ran):

- If they pass, continue.
- If a merge broke something the individual slices didn't — a duplicate symbol, a type mismatch across the seam, a now-missing import — fix what the integration broke. Keep these fixes minimal and at the seam; do not redesign a feature here.
- If the breakage needs real design work, leave it: mark the affected feature `blocked` with the integration failure as the reason, and surface it in Step 8.

Behavioral verification still belongs to `/qa` — Step 6 only confirms the merged tree is internally consistent.

## Step 7: Write back docs, clean up worktrees

From each subagent's final message, update its feature spec in `.harness/engineering/features/[slug].md`: set the Status line to the final `done` or `blocked` (accounting for any merge or integration outcome above), and add the reported implementation note. Make these edits in your own checkout — that is the only place `.harness/` exists.

Then clean up every worktree and branch:

```bash
git worktree remove .claude/worktrees/<agent-id>   # repeat for each
git branch -d <worktree-branch>                     # use -D for an aborted/unmerged branch
```

Do this before reporting. Leaving worktrees behind clutters `git worktree list` and leaves stale branches in the repo.

## Step 8: Report

After all merges, the integration check, and cleanup are done:

- List every feature: final status (`done` / `blocked`), files created or modified
- For `blocked` features: the exact reason (spec gap, merge conflict, or integration failure) and what would unblock them
- For `done` features: one-line summary of what was built
- Note any seam fixes you made during the integration check

Recommend next step:
- All AFK done, no HITL: "Run /qa to verify Phase [N], or /implement for Phase [N+1]."
- HITL features pending: "Resolve [question] to unblock [feature]."
- Blocked features: "Resolve the blockers listed above before continuing."
