---
name: migrate-docs
description: "Discover all existing documentation in the repo — public and private, wherever it lives — classify each file, transform the content to match harness templates, and migrate everything to the correct location (.harness/ for internal docs, repo root for public docs). Use on any existing project to adopt the harness workflow without starting from scratch. Safe: never deletes originals without explicit confirmation."
---

# Migrate Docs

## What this skill does

Scans the repo for every documentation file, classifies each one as public or internal, transforms the content to match harness file templates (preserving all information), writes to the correct harness location, and removes the originals only after explicit confirmation.

The result is a clean harness-structured project ready to continue with `/product-plan`, `/dev-plan`, or whichever step in the workflow comes next.

## Step 1: Discover

Scan the entire repo for documentation. Do not limit yourself to obvious locations — check everywhere.

**Root-level files** — check for all of these by name:
`README.md`, `CHANGELOG.md`, `HISTORY.md`, `CONTRIBUTING.md`, `CONTRIBUTION.md`, `DESIGN.md`, `SPEC.md`, `PRD.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and any other `.md` files at the root.

**Common doc directories** — scan recursively:
`docs/`, `documentation/`, `wiki/`, `spec/`, `specs/`, `notes/`, `planning/`, `design/`, `.github/`

**Package manifests** — check for usable product context:
`package.json` → description, keywords, homepage
`pyproject.toml`, `go.mod`, `Cargo.toml` → name, description

**Existing harness structure** — read `.harness/` if it already exists, to avoid overwriting content that has already been migrated.

Build a complete inventory: `path`, a one-line description of what the content is about, and approximate size. Include everything — classify later.

## Step 2: Classify

For each file in the inventory, assign a classification:

**`keep-public`** — stays at repo root, no content changes needed:
- `README.md`, `CHANGELOG.md` / `HISTORY.md`, `LICENSE`, `CONTRIBUTING.md` / `CONTRIBUTION.md`, `DESIGN.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`

**`clean-public`** — stays at repo root but contains internal content that must be extracted:
- A `README.md` that has architecture decisions, competitor tables, internal strategy, or tech debt notes
- Any root file that mixes user-facing content with internal content

**`migrate`** — move entirely to `.harness/`:

| Content type | Destination |
|---|---|
| Product vision, purpose, problem statement, audience | `.harness/product/product.md` |
| Roadmap, backlog, feature lists, sprint plans | `.harness/product/roadmap.md` |
| Competitive analysis, market research, landscape | `.harness/product/competitors.md` |
| UX flows, wireframe notes, interaction design | `.harness/product/ux.md` |
| Domain glossary, terminology, entity definitions | `.harness/product/CONTEXT.md` |
| Idea notes, viability research, early explorations | `.harness/product/idea.md` |
| System architecture, tech stack, component design | `.harness/engineering/architecture.md` |
| Implementation plans, task lists, milestones | `.harness/engineering/implementation-plan.md` |
| Per-feature specs or technical designs | `.harness/engineering/features/[slug].md` |
| Architecture Decision Records | `.harness/adr/NNNN-[slug].md` |
| QA reports, test results, bug logs | `.harness/qa/report.md` |

**`split`** — file contains content for more than one harness destination. List each destination and which portion of the content goes there.

**`ignore`** — generated files, changelogs inside `node_modules`, auto-generated API references, lock files, README files inside dependency folders.

## Step 3: Show the plan and confirm

Present a clear table:

```
| Current path            | Action        | Destination                              |
|-------------------------|---------------|------------------------------------------|
| docs/vision.md          | migrate       | .harness/product/product.md              |
| docs/ARCHITECTURE.md    | migrate       | .harness/engineering/architecture.md     |
| README.md               | clean-public  | README.md (extract strategy to .harness) |
| docs/notes.md           | split         | .harness/product/product.md (§1–3)       |
|                         |               | .harness/engineering/architecture.md (§4)|
| CHANGELOG.md            | keep-public   | CHANGELOG.md                             |
```

Also list:
- **Harness files with no source** — will be created as stubs (empty sections)
- **Files that will be ignored** and why

Ask: "Does this migration plan look right? Anything to change before I proceed?"

Wait for explicit confirmation. Do not write any files until the user approves.

## Step 4: Gitignore check

Before writing anything, check whether `.harness/` is in `.gitignore`. If not, add it:
```
echo '.harness/' >> .gitignore
```
Only add if not already present.

## Step 5: Migrate — spawn parallel subagents

Spawn one subagent per destination harness file. Subagents run in parallel.

Each subagent receives:
1. The full content of every source file that maps to this destination
2. The destination path
3. The harness template for that file (see below)
4. These instructions:

```
Transform the source content into the harness template format below.

Rules:
- Preserve ALL information from the source — do not discard, summarise away,
  or paraphrase into vagueness anything that existed in the original
- Restructure into the template sections; if content doesn't fit a named
  section, add it under the closest match
- Do not invent content for sections with no source — leave them empty rather
  than filling them with placeholders
- If the source covers more than this file's scope, include only the relevant
  portion; the rest will be handled by a parallel subagent
- If the source is already well-structured and close to the template,
  preserve its wording; only reformat the headings
- Write the result to the destination path
```

### Templates

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

**.harness/engineering/features/[slug].md** — one file per feature found in specs or roadmap
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

## Step 6: Handle clean-public files

For files classified as `clean-public`:
1. Extract the internal content to the appropriate `.harness/` file (handled by the relevant subagent above)
2. After subagents finish, edit the public file to remove the extracted sections
3. Ensure what remains reads cleanly without the removed sections — update transitions if needed
4. Never leave a dangling reference to content that was moved

## Step 7: Confirm deletion

After all subagents have finished and all harness files have been written:

List every original file that was fully migrated (i.e., all its content now lives in `.harness/`).

Ask: "All content has been written to its harness location. Delete the originals? Empty directories will also be removed."

Wait for confirmation.

If confirmed:
- Delete each original file
- Remove any directories that are now entirely empty (e.g., `docs/` if all its contents were migrated)

**Never delete an original if there is any doubt that its content was fully captured.**

## Step 8: Report

After cleanup, produce a summary:

```
## Migration complete

### Written to .harness/
- [path] — migrated from [source] / created as stub

### Public docs (kept or cleaned)
- [path] — [kept unchanged / internal content extracted to .harness/...]

### Originals deleted
- [path]
- [directory] (was empty after migration)

### Stubs created (no source content found)
- [path] — populate with /[skill-name]

### Suggested next step
```

The suggested next step should reflect the state of the harness after migration:
- Product docs present, no engineering docs → `/dev-plan`
- Engineering docs present, no feature specs → `/dev-plan`
- Feature specs present, no QA report → `/implement` or `/qa`
- All docs present → `/update-docs` to sync and verify everything is current
- Product docs thin or absent → `/product-plan` to fill the gaps
