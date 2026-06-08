---
name: implement
description: Classify planned features as autonomous or human-approval-required, then implement the current phase as parallel vertical slices — one subagent per feature. Use after dev-plan (and optionally prototype) has produced complete feature specs.
---

# Implement

## Step 1: Read the context

Read everything. Subagents cannot access the codebase — you are their only source of context.

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

## Step 4: Implement as vertical slices

Each agent implements ONE feature end-to-end through all layers — not one layer across all features.

A vertical slice means: from the user-facing entry point (UI interaction, CLI command, API endpoint) all the way through to storage, for this feature only. The agent implements exactly what this feature needs at each layer — not shared infrastructure, not future-proofing, not refactors.

This ensures each feature is independently demoable and verifiable the moment the agent finishes.

### For each AFK feature, spawn one subagent

See [REFERENCE.md](REFERENCE.md) for the full context list and instructions to include in each subagent prompt. Include all six context items — subagents have no other source of information.

### If features within the phase depend on each other

Implement blocking features first (sequentially), then run the remaining independent features in parallel.

## Step 5: Report

After all subagents finish:

- List every feature: final status (`done` / `blocked`), files created or modified
- For `blocked` features: the exact reason and what would unblock them
- For `done` features: one-line summary of what was built

Recommend next step:
- All AFK done, no HITL: "Run /qa to verify Phase [N], or /implement for Phase [N+1]."
- HITL features pending: "Resolve [question] to unblock [feature]."
- Blocked features: "Resolve the blockers listed above before continuing."
