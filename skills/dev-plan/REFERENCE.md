# Dev Plan — Reference

## Interview Dimensions

### 1. Architecture
- What's the right high-level structure? (monolith, client-server, CLI, library, services, etc.)
- Where does state live and how does it flow through the system?
- What are the system boundaries — in scope vs. delegated to external services?

### 2. Tech stack
- What language(s) and runtime? Why — performance, ecosystem, team familiarity, product constraints?
- What framework, if any? Does the product's scale and complexity warrant one?
- What storage layer? Relational, document, key-value, file-based, or none?

### 3. Key libraries and tools
- For each major product feature in the roadmap, what specific library or tool handles it?
- What's the testing approach — unit, integration, e2e? What framework?
- What build, bundling, or deployment tooling is needed?

### 4. Data model
- What are the core entities and their relationships?
- What operations need to be fast? What can be slow?
- What's the expected data volume and growth trajectory?

### 5. Implementation approach
- Is this greenfield, extending existing code, or refactoring?
- What can be reused from the current codebase as-is?
- What needs to be removed, replaced, or significantly changed?
- What's the right order — what must exist before other things can be built?

### 6. Constraints
- What's the timeline or scope constraint?
- Solo or team? If team, what are the skill or ownership boundaries?
- What infrastructure is already in place and must be respected?

### 7. Visual design *(only if the product has a UI)*
- What is the color palette? Lead with a concrete proposal derived from `.harness/product/ux.md` — name the primary, secondary, accent, and neutral hex values.
- What is the type system? Propose specific font families and a scale (h1, body, label at minimum).
- What are the spacing and border-radius scales?
- Are there key components (button, card, input) whose token values should be pinned now?
- Does the stack export to Tailwind v4 CSS, Tailwind v3 JSON, or W3C DTCG format?

### 8. Key tradeoffs
- What's the highest-risk architectural decision — most likely to require revisiting?
- Where is complexity being traded for simplicity (or vice versa), and is that the right call?
- What would you design differently with 10× the time or 10× the users?

---

## Document Templates

### Subagent A

**.harness/engineering/architecture.md**
```
# Architecture

## Overview
One paragraph. What this system is and how it's structured.

## Components
Key components and their responsibilities.

## Data flow
How data moves through the system. Prose or a simple ASCII diagram.

## Stack
- Language: ...
- Framework: ...
- Database / storage: ...
- Key libraries: [library] — [what it handles]

## Key decisions
The 2–3 choices that shaped this architecture and why.

## Open questions
Unresolved decisions that affect the implementation.
```

**DESIGN.md** *(only if a UI was discussed)* — written to the **repo root**, not `.harness/`. Uses the [DESIGN.md format](https://github.com/google-labs-code/design.md). YAML front matter holds exact token values; markdown prose explains rationale.
```
---
name: [Product name]
colors:
  primary: "#..."
  secondary: "#..."
  accent: "#..."
  neutral: "#..."
typography:
  h1:
    fontFamily: ...
    fontSize: ...
  body-md:
    fontFamily: ...
    fontSize: ...
rounded:
  sm: ...
  md: ...
spacing:
  sm: ...
  md: ...
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#..."
    rounded: "{rounded.sm}"
---

## Overview
One paragraph on the visual identity — register, mood, reference points.

## Colors
What each color is for and why it was chosen.

## Typography
Font choices and the reasoning behind them.

## Components
Key component decisions and any variants.
```
Validate after writing: `npx @google/design.md@0.2.0 lint DESIGN.md`

### Subagent B

**.harness/engineering/implementation-plan.md** — defines WHAT to build and WHEN. Feature specs define HOW — do not duplicate technical detail here. If there is a conflict, the feature spec takes precedence.
```
# Implementation Plan

## Phase 1: [Name — e.g. Foundation]
Tasks that must happen first. Later phases depend on these.

### Task 1.1 — [Short title]
**Goal**: What this task produces when done.
**Scope**: Which files or modules to create or modify.
**Acceptance criteria**: How to verify the task is complete.
**Depends on**: (omit if none)

## Phase 2: [Name]
...
```
Keep each task scoped to what a single agent can complete in one session.

**.harness/adr/NNNN-short-slug.md** — create one only when ALL THREE conditions hold: the decision is hard to reverse; a future agent would find it surprising without context; it resulted from genuine trade-offs between real alternatives. Sequence continues from existing ADRs.
```
# NNNN — [Short title: what was decided]

**Status**: accepted

## Context
What prompted this decision. Key constraints or forces at play.

## Options considered
- **Option A** — one-line summary, key tradeoff
- **Option B** — one-line summary, key tradeoff

## Decision
What was chosen and why. One short paragraph.

## Consequences
What this makes easier. What this makes harder or forecloses.
```

### Subagent C

Also pass the full content of `.harness/product/CONTEXT.md` — use domain vocabulary exactly throughout all specs.

For each must-have feature in `.harness/product/roadmap.md`, create `.harness/engineering/features/[slug].md`:
```
# [Feature Name]

**Status**: planned

## Goal
What this feature achieves for the user. One sentence.

## User stories
- As a [actor], I want [capability], so that [benefit]

## Scope
What's included. What's explicitly out of scope.

## Technical approach
How to implement this feature given the architecture. Specific: which files to create or modify, which functions or APIs to use, what the data flow looks like.

## Data / API contracts
Key types, interfaces, endpoints, request/response shapes. Only what this feature introduces or changes.

## Edge cases & constraints
Known failure modes, validation rules, performance requirements, error states.

## Acceptance criteria
- [ ] [Behavior criterion, e.g. "User sees X when Y"]

## Implementation notes
(to be filled in during /implement)
```

Do not generate specs for should-have or nice-to-have features unless needed to unblock a must-have.
