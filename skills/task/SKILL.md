---
name: task
description: Make a small change to a shipped product — a bug fix, behavior tweak, or micro-feature — as one verified slice, syncing the affected feature spec on the way out. Use for day-to-day requests like "fix X", "change Y to do Z", or a single small feature that doesn't warrant a full phase of the workflow.
---

# Task

One small change, done end-to-end: classify, fix, verify, sync the docs. No interview, no phase ceremony. The point is that `.harness/` stays truthful as a side effect of doing the work.

## Step 1: Classify and scope

Restate the request in one sentence. Then classify:

- **Bug** — the product violates its own spec. The spec is right; the code is wrong.
- **Behavior change** — the spec said one thing, the user now wants another.
- **Micro-feature** — new behavior, small enough that a spec interview would be ceremony.

Find what's affected: grep `.harness/engineering/features/` for the feature(s) this touches, and read the relevant spec plus `AGENTS.md` and `.harness/product/CONTEXT.md` if they exist.

**Escalate instead of proceeding** if any of these turn out true — recommend the right skill and stop:
- It's a meaningful new feature or behavior change that warrants a product conversation → `/evolve`
- It needs an architectural decision not covered by `architecture.md` or ADRs → `/evolve` then `/dev-plan`
- It spans several features or layers in non-trivial ways → `/implement` with proper specs
- It has security, auth, data-migration, or external-contract implications → surface the question to the user first

## Step 2: Fix as one vertical slice

Implement only this change, entry point through to storage:
- Match existing conventions and use the domain vocabulary from `CONTEXT.md`
- No refactors, no shared infrastructure, no adjacent improvements
- If the change contradicts an acceptance criterion, that's expected for a behavior change — Step 4 fixes the spec, not the other way around

## Step 3: Verify

Batch size is one, so verify directly (the /implement-vs-/qa split doesn't apply here):
- Run static checks (typecheck, build, lint)
- Run the narrowest test that covers the change; for a bug, write the failing test first if the suite makes that cheap
- Exercise the change where it runs if a runtime is available (browser, simulator, CLI)

Not verified → not done. Don't hand unverified changes back.

## Step 4: Sync the docs

- **Bug**: spec was already right — no spec change. Note the fix only if the spec's implementation note is now misleading.
- **Behavior change**: patch the acceptance criterion in the affected spec to describe the new behavior, with a dated one-line note ("Changed 2026-06-10: due date now resets on duplication").
- **Micro-feature**: add a minimal spec file to `.harness/engineering/features/` — status `done`, the acceptance criteria you just verified, one-line implementation note. This keeps future `/qa` runs covering it.
- Touch `.harness/product/roadmap.md` only if the change alters something the roadmap states.
- If a README or other public doc describes the old behavior, update it.

## Step 5: Report and recommend

Report: what changed (files), how it was verified, which docs were synced.

- User-visible change on a released product → "Run /ship for a patch release."
- Internal-only → done, nothing else needed.
- Found related problems along the way → list them; don't fix them in this task.
