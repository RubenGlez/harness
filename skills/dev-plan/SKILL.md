---
name: dev-plan
description: Analyze product docs from an engineering perspective to decide architecture, tech stack, tools, and implementation approach — then generate a technical spec for every feature in the roadmap. Reads .harness/product/ first, interviews the user, then writes docs via parallel subagents. Use after product-plan. The output feeds directly into implement.
---

# Dev Plan

## Step 1: Read the context

Before asking anything, gather context from two sources.

**Product docs** — read `.harness/product/` if it exists:
- `.harness/product/product.md` — what's being built and for whom
- `.harness/product/roadmap.md` — feature priorities (focus on must-haves)
- `.harness/product/ux.md` — UX workflows and design direction
- `.harness/product/competitors.md` — competitive landscape for technical benchmarking
- `.harness/product/CONTEXT.md` — domain vocabulary; use these exact terms in all feature specs and code

**Codebase** — explore what already exists:
- Read README.md and CLAUDE.md for stated architecture and setup
- Identify the tech stack already in use (languages, frameworks, databases, key libraries)
- Scan key directories to understand what's built, what's stubbed, what's absent
- Check `.harness/engineering/` and `.harness/adr/` to avoid re-deciding settled questions

Synthesize into an internal picture: what needs to be built or changed, what constraints exist, where the real decisions are. Do not share this — use it to skip obvious questions.

## Step 2: Interview

Interview the user one question at a time. For every question, lead with your recommendation first — state what you'd choose and why, then ask if they agree. Never ask a bare question.

Be direct about tradeoffs. When a choice has real costs, name them. When a popular tool is the wrong fit, say so. When the user's preference conflicts with what the product needs, surface that conflict.

If a question can be answered by reading the codebase or product docs, answer it yourself and move on.

## Interview Dimensions

Work through these in order; skip or combine when the answer is already clear.

**1. Architecture**
- What's the right high-level structure? (monolith, client-server, CLI, library, services, etc.)
- Where does state live and how does it flow through the system?
- What are the system boundaries — in scope vs. delegated to external services?

**2. Tech stack**
- What language(s) and runtime? Why — performance, ecosystem, team familiarity, product constraints?
- What framework, if any? Does the product's scale and complexity warrant one?
- What storage layer? Relational, document, key-value, file-based, or none?

**3. Key libraries and tools**
- For each major product feature in the roadmap, what specific library or tool handles it?
- What's the testing approach — unit, integration, e2e? What framework?
- What build, bundling, or deployment tooling is needed?

**4. Data model**
- What are the core entities and their relationships?
- What operations need to be fast? What can be slow?
- What's the expected data volume and growth trajectory?

**5. Implementation approach**
- Is this greenfield, extending existing code, or refactoring?
- What can be reused from the current codebase as-is?
- What needs to be removed, replaced, or significantly changed?
- What's the right order — what must exist before other things can be built?

**6. Constraints**
- What's the timeline or scope constraint?
- Solo or team? If team, what are the skill or ownership boundaries?
- What infrastructure is already in place and must be respected?

**7. Visual design** *(only if the product has a UI)*
- What is the color palette? Lead with a concrete proposal derived from `.harness/product/ux.md` — name the primary, secondary, accent, and neutral hex values.
- What is the type system? Propose specific font families and a scale (h1, body, label at minimum).
- What are the spacing and border-radius scales?
- Are there key components (button, card, input) whose token values should be pinned now?
- Does the stack export to Tailwind v4 CSS, Tailwind v3 JSON, or W3C DTCG format?

**8. Key tradeoffs**
- What's the highest-risk architectural decision — most likely to require revisiting?
- Where is complexity being traded for simplicity (or vice versa), and is that the right call?
- What would you design differently with 10× the time or 10× the users?

## Step 3: Engineering Summary

After the interview, produce a brief summary:

- **Architecture**: one paragraph on the chosen structure and why
- **Stack**: language, framework, database, key libraries — with rationale for each
- **Implementation approach**: build new / extend / refactor, and the phase order
- **Visual design tokens**: palette, type system, spacing scale, component tokens (if UI)
- **Key decisions**: the 2–3 choices that constrain everything else
- **Open questions**: anything unresolved that affects what gets built

## Step 4: Write docs

Spawn three subagents in parallel. Pass the full engineering summary as context in each prompt — subagents cannot read the conversation.

### Gitignore check

Before writing any file, check whether `.harness/` is covered by `.gitignore`. If not, add it:
```
echo '.harness/' >> .gitignore
```
Only add it if the entry isn't already present.

### Document rules

- All internal files go under `.harness/`. Create subdirectories if they don't exist.
- Update existing files rather than overwrite.
- Omit any section not covered in the summary rather than inventing content.
- **Never link to `.harness/` files from any public document** (README.md, CHANGELOG.md, CONTRIBUTION.md, LICENSE, DESIGN.md).

---

**Subagent A** writes the descriptive docs — what the system is and how it looks.

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

**DESIGN.md** *(only if a UI was discussed)* — written to the **repo root**, not `.harness/`. Uses the [DESIGN.md format](https://github.com/google-labs-code/design.md). YAML front matter holds the exact token values; markdown prose explains the rationale.
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
Validate after writing: `npx @google/design.md lint DESIGN.md`

---

**Subagent B** writes the prescriptive docs — what to build and what was decided.

**.harness/engineering/implementation-plan.md** — phase and task ordering for agent delegation. This document defines WHAT to build and WHEN (phases, sequence, dependencies). Individual feature specs (`.harness/engineering/features/[slug].md`) define HOW to build each feature — do not duplicate technical detail here. If there is ever a conflict between this plan and a feature spec, the feature spec takes precedence. Each task must be self-contained enough for an agent to pick up without reading this conversation.
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
Keep each task scoped to what a single agent can complete in one session. If a task is too large, split it.

**.harness/adr/NNNN-short-slug.md** — create one only when ALL THREE conditions hold simultaneously:
1. The decision is hard to reverse once committed
2. A future agent would find it surprising without context
3. It resulted from genuine trade-offs between real alternatives

Skip decisions that are obvious, ephemeral ("not worth it right now"), or self-evident from reading the code. Sequence continues from existing ADRs in `.harness/adr/` (0001 if none exist).
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

---

**Subagent C** writes a technical spec for every must-have feature in the roadmap.

Also pass the full content of `.harness/product/CONTEXT.md` in this subagent's prompt. Use the domain vocabulary exactly throughout all specs: actor names in user stories, entity names in data contracts, and concept names in acceptance criteria.

For each must-have feature in `.harness/product/roadmap.md`, create one file at `.harness/engineering/features/[slug].md` where slug is the feature name lowercased with hyphens.

Each file follows this format:
```
# [Feature Name]

**Status**: planned

## Goal
What this feature achieves for the user. One sentence.

## User stories
- As a [actor], I want [capability], so that [benefit]
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
Verifiable through the public interface — what the user experiences, not what the code looks like inside:
- [ ] [Behavior criterion, e.g. "User sees X when Y"]
- [ ] [Behavior criterion]

## Implementation notes
(to be filled in during /implement)
```

Do not generate specs for should-have or nice-to-have features unless they are needed to unblock a must-have.

---

After all subagents finish, confirm every file written with a one-line summary of what changed. Recommend the next step: "Run /implement to build Phase 1 features."
