---
name: implement
description: Read the engineering docs and implement the next phase of features using parallel subagents. Each subagent receives the full context it needs — architecture, feature spec, codebase state, conventions — and implements one feature independently. Updates feature status in .harness/engineering/features/. Use after dev-plan has produced feature specs and an implementation plan.
---

# Implement

## Step 1: Read the context

Read everything. Subagents cannot access the codebase — you are their only source of context.

**Internal docs**
- `.harness/engineering/architecture.md` — stack, components, data flow, constraints
- `.harness/engineering/implementation-plan.md` — phases and task ordering
- `.harness/engineering/features/` — all feature spec files (read every one)
- `.harness/adr/` — architectural decisions that constrain implementation

**Codebase**
- `CLAUDE.md` — conventions, naming, patterns, do-not-edit files
- `README.md` — public description, install/run instructions
- Scan key directories: identify what files exist, what each does, what's absent
- Check `package.json` / `pyproject.toml` / `go.mod` — dependencies and scripts

**Build a dependency map:**
- Which features are `planned`?
- Which phase is current — the lowest phase number that has `planned` features?
- Within the current phase, are any features dependent on others in the same phase?

Do not proceed to Step 2 until you have a complete picture of the codebase and all feature specs.

## Step 2: Confirm scope with the user

Present:
- Current phase name and number
- Features you plan to implement in this run (parallel)
- Any that are `blocked` and why
- Any dependencies within the phase that require sequencing

Example:
> "Ready to implement Phase 1 — Foundation:
> - user-authentication (parallel)
> - project-creation (parallel)
> - database-schema (must run first — others depend on it)
>
> I'll implement database-schema first, then the other two in parallel. Proceed?"

Wait for confirmation before spawning agents.

## Step 3: Implement

### If there are dependencies within the phase
Implement blocking features first (one at a time), then proceed to parallel features.

### For each feature batch, spawn one subagent per feature

Each subagent prompt must include all of the following — subagents have no other context:

**1. Architecture**
Full content of `.harness/engineering/architecture.md`

**2. Feature spec**
Full content of this feature's `.harness/engineering/features/[slug].md`

**3. Codebase snapshot**
- Directory structure (key directories and files)
- Content of any files the feature will need to read or modify
- What already exists that can be reused

**4. Conventions**
Full content of `CLAUDE.md`

**5. Instructions**
```
Implement the feature described in the spec above.
- Follow the architecture and conventions exactly.
- Only create or modify the files within the scope defined in the spec.
- Do not introduce features, abstractions, or error handling beyond what the spec requires.
- When done, update the Status line in the feature spec file from `planned` to `done`.
- If you cannot complete the feature due to a missing dependency or ambiguity, set Status to `blocked` and add a note explaining exactly what's missing.
```

Do not share other features' specs with a subagent unless the spec explicitly lists them as dependencies.

## Step 4: Report

After all subagents finish:

- List every feature: final status (`done` / `blocked`), files created or modified
- For `blocked` features: explain exactly what's needed to unblock
- Recommend next step:
  - All done, phase complete: "Run /qa to verify, or /implement again to proceed to Phase [N+1]."
  - Remaining planned features: "Phase [N] has outstanding features — run /implement again."
  - Blocked features: "Resolve the blockers listed above before continuing."
