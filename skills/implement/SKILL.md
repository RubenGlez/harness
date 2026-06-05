---
name: implement
description: Read the engineering docs, classify each feature as HITL (needs human approval) or AFK (autonomous), then implement the next phase as vertical slices using parallel subagents. Each subagent implements one feature end-to-end through all layers. Updates feature status in .harness/engineering/features/. Use after dev-plan (and optionally prototype) has produced feature specs.
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
- `CLAUDE.md` — conventions, naming, patterns, do-not-edit files
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

Each subagent prompt must include all of the following — subagents have no other context:

**1. Architecture**
Full content of `.harness/engineering/architecture.md`

**2. Feature spec**
Full content of this feature's `.harness/engineering/features/[slug].md`

**3. Domain vocabulary**
Full content of `.harness/product/CONTEXT.md` if it exists. Use these terms exactly in all code: function names, variable names, type names, comments.

**4. Codebase snapshot**
- Directory structure (key directories and files)
- Full content of any files the feature will need to read or modify
- What already exists that can be reused

**5. Conventions**
Full content of `CLAUDE.md`

**6. Instructions**
```
Implement the feature described in the spec as a vertical slice:
- Start from the user-facing entry point (UI, CLI command, or API endpoint)
- Trace the path through to the data layer
- Implement only what this specific feature needs at each layer
- Do not implement shared infrastructure unless this feature requires it
- Do not refactor existing code unless the feature cannot work without it
- Focus on implementation only — do not run the test suite or attempt to verify your work; the /qa skill handles all verification
- Use the domain vocabulary exactly as defined in CONTEXT.md for all identifiers
- When done, update the Status line in the feature spec file from `planned` to `done`
  and add a brief implementation note describing what was built
- If you cannot complete the feature: set Status to `blocked` and explain exactly what's missing
```

Do not share other features' specs with a subagent unless the spec explicitly lists them as dependencies.

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
