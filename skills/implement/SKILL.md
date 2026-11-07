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
- `.harness/engineering/features.md` — the feature spec sections (read the relevant ones)
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
- Vague or missing acceptance criterion → patch the criterion in the feature's section of `.harness/engineering/features.md`.
- Architectural or stack choice → update `.harness/engineering/architecture.md`, and open an ADR in `.harness/adr/` if it constrains future work.
- Security / auth / data decision → record it in the feature spec and, if cross-cutting, an ADR.

Only after the resolution is on disk does the feature become AFK. Then commit: `git add .harness && git commit -m "docs: persist HITL resolutions"`. Step 4 worktrees are created from HEAD — an uncommitted spec fix never reaches the subagent.

## Step 4: Implement as vertical slices

> **Runtime note:** the parallel-subagent + worktree flow in this step is Claude-specific. On a runtime without it (e.g. Codex), see [../_shared/runtime-parallelism.md](../_shared/runtime-parallelism.md) and build the slices sequentially — the vertical-slice boundaries and single-writer rule still apply.

Each agent implements ONE feature end-to-end through all layers — not one layer across all features.

A vertical slice means: from the user-facing entry point (UI interaction, CLI command, API endpoint) all the way through to storage, for this feature only. The agent implements exactly what this feature needs at each layer — not shared infrastructure, not future-proofing, not refactors.

This ensures each feature is independently demoable and verifiable the moment the agent finishes.

Subagent worktrees are created under `.claude/worktrees/`. Before spawning, make sure that path is gitignored (`grep -qxF '.claude/worktrees/' .gitignore || echo '.claude/worktrees/' >> .gitignore`) so an interrupted run that skips the Step 7 cleanup can't leave untracked worktrees that get committed by a later `git add`.

### For each AFK feature, spawn one subagent

See [REFERENCE.md](REFERENCE.md) for the prompt structure: the feature spec and shared context docs referenced by path, a short codebase orientation, and the implementation instructions.

### If features within the phase depend on each other

Implement blocking features first (sequentially), then run the remaining independent features in parallel.

## Step 5: Merge

Subagents read `.harness/` in their worktrees but must never edit it — the specs are the orchestrator's contract (parallel spec writes merge byte-wise but conflict semantically). They report their results instead (see [REFERENCE.md](REFERENCE.md)); you are the only writer of `.harness/`.

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

Then run [/review-diff](../review-diff/SKILL.md) with the commit you were on before Step 5's first merge as the fixed point. It reads the diff, it doesn't run it, so it stays within this skill's static-only contract. A Spec finding that a feature's acceptance criterion is missing or partial means that feature isn't done: confirm the gap yourself against the quoted criterion and the code, then mark it `blocked` with the gap as the reason. Drop findings you can't confirm. Standards findings don't block; list them in Step 8.

## Step 7: Write back docs, clean up worktrees

From each subagent's final message, update its feature's section in `.harness/engineering/features.md`: set the Status line to the final `done` or `blocked` (accounting for any merge or integration outcome above), and add the reported implementation note. Make these edits in your own checkout and commit them (`git add .harness && git commit -m "docs: phase [N] status write-back"`) — subagents never write `.harness/`, so this is the only write.

Then clean up every worktree and branch:

```bash
git worktree remove .claude/worktrees/<agent-id>   # repeat for each
git branch -d <worktree-branch>                    # merged branches only
```

For a feature whose merge was aborted or that ended `blocked`, its branch is unmerged — **keep it.** Deleting it would need `git branch -D`, which the block-dangerous-git hook stops, and doing so would strand the feature's work. Remove only its worktree, and name the surviving branch in the Step 8 report so the work is recoverable.

Do this before reporting. Leaving *merged* branches or worktrees behind clutters `git worktree list` and the repo.

## Step 8: Report

After all merges, the integration check, and cleanup are done:

- List every feature: final status (`done` / `blocked`), files created or modified
- For `blocked` features: the exact reason (spec gap, merge conflict, or integration failure) and what would unblock them
- For `done` features: one-line summary of what was built
- Note any seam fixes you made during the integration check
- `/review-diff` Standards findings, as follow-ups

Recommend next step:
- All AFK done, no HITL: "Run /qa to verify Phase [N], or /implement for Phase [N+1]."
- HITL features pending: "Resolve [question] to unblock [feature]."
- Blocked features: "Resolve the blockers listed above before continuing."
