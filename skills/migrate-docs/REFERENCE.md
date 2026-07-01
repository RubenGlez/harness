# Migrate Docs — Reference

## Harness File Templates

**.harness/product/idea.md**
```
# Idea: [Name]

## Concept
One sentence: what it does and who it's for.

## Problem
The specific pain being solved. Who feels it, how often, how they deal with it today.

## Market landscape

### Existing solutions
| Solution | What it does | Main weakness | Stars / traction |
|----------|-------------|---------------|------------------|

### Market saturation

### User pain signals

### Opportunity

## Viability assessment
**Verdict**:
**Reasons**:
**Key assumptions to validate**:

## Sources
```

**.harness/product/product.md**
```
# [Product Name]

## What it is
## Value Proposition
## Audience
## Positioning
## Direction Assessment
## Key Risks
```

**.harness/product/roadmap.md**
```
# Roadmap

## Must-have
- [ ] Feature — rationale

## Should-have
- [ ] Feature — rationale

## Nice-to-have
- [ ] Feature — rationale
```

**.harness/product/competitors.md**
```
# Competitive Analysis

## [Competitor]
What they do well. Where they fall short. Why users switch away.

## Gap this product fills
```

**.harness/product/ux.md**
```
# UX & Design Direction

## Core workflow
## Interaction model
## Design register
## Key UX decisions
```

Use `.harness/product/ux.md` for internal design direction: workflow rationale, interaction model, design principles, creative north star, and UX decisions. If an existing `DESIGN.md` is mostly prose about how the product should feel or behave, migrate that content here.

Keep root `DESIGN.md` only for public design-token specifications: exact color, typography, spacing, radius, and component token values plus contributor-facing implementation rules. If a design file mixes token values with UX rationale, split it instead of preserving the mixed file.

**.harness/product/CONTEXT.md**
```
# Domain Glossary

## [Term]
[Precise one-sentence definition: what it IS in this product]
```

**.harness/engineering/architecture.md**
```
# Architecture

## Overview
## Components
## Data flow
## Stack
- Language:
- Framework:
- Database / storage:
- Key libraries:
## Key decisions
## Open questions
```

**.harness/engineering/implementation-plan.md**
```
# Implementation Plan

## Phase 1: [Name]

### Task 1.1 — [Title]
**Goal**:
**Scope**:
**Acceptance criteria**:
**Depends on**:
```

**.harness/engineering/features/[slug].md** — one file per feature
```
# [Feature Name]

**Status**: planned

## Goal
## User stories
- As a [actor], I want [capability], so that [benefit]
## Scope
## Technical approach
## Data / API contracts
## Edge cases & constraints
## Acceptance criteria
- [ ] [Behavior criterion]
## Implementation notes
```

**.harness/adr/NNNN-[slug].md** — one file per ADR or decision record found
```
# NNNN — [Title]

**Status**: accepted

## Context
## Options considered
- **Option A** —
- **Option B** —
## Decision
## Consequences
```

**.harness/qa/report.md**
```
# QA Report — [Date]

## Summary
## Results by feature
## Outstanding issues
## Architectural gaps
```

---

## Adopting doctier on a repo with an existing (gitignored) `.harness/`

For projects that used harness before `.harness/` was git-tracked. The docs already exist on disk; the goal is to start tracking them encrypted without ever committing plaintext.

1. `rm -rf .harness/.base` — stale seed snapshot left by the old worktree hook, if present.
2. Run the doctier bootstrap from SKILL.md Step 4 (write the manifest, then `doctier init`, then `doctier grant`), including removing the legacy standalone `.harness/` line from `.gitignore`.
3. `doctier check` — must pass before tracking anything.
4. `git add .doctier.yml .doctier/ .gitattributes .gitignore .github/CODEOWNERS .harness/`
5. Verify encryption: `git show :.harness/<any-file> | head -1` must be an age/doctier envelope, not your prose. If it is plaintext, the filter is not active — stop, `git reset`, and re-run `doctier init` before trying again.
6. `git commit -m "chore: adopt doctier; track .harness/ encrypted"`
7. Old linked worktrees still carry seeded plaintext copies of `.harness/` — remove and recreate them so they use the tracked docs. (To refresh in place: `rm -rf .harness && git checkout -- .harness` inside the worktree — the `rm` is required, a plain checkout no-ops when the index already matches.)
