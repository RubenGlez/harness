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
