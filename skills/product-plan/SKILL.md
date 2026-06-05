---
name: product-plan
description: Interview the user about a product idea or existing product to assess target audience, market fit, competitive landscape, feature priority, UX workflows, and design direction. Then writes structured docs to .harness/product/ via a subagent. Use when the user wants to validate a new idea, stress-test product direction, identify what features to build next, or define UX flows. Distribution is out of scope.
---

# Product Plan

## Step 1: Read the project

Before asking anything, explore the codebase to build a picture of what already exists:

- Read README.md or any public docs in the root for stated goals and audience
- Scan the feature surface: routes, screens, commands, or API endpoints
- Check `.harness/product/` for existing decisions to update rather than re-litigate
- Check the roadmap or issue tracker if present (`gh issue list`)
- Note what's implemented, what's stubbed, and what's conspicuously absent

Synthesize into a one-paragraph internal picture: what it does, who it seems built for, where it's headed. Do not share this — use it to skip questions the codebase already answers and form sharper hypotheses for the ones you do ask.

## Step 2: Interview

Interview the user relentlessly — one question at a time. For every question, state a concrete recommendation or hypothesis first. Never ask a bare question. Lead with your position — "My read is X. Do you agree?" — so the user reacts to a specific claim, not a blank.

**Be a realist, not a cheerleader.** Surface the truth, not validation:

- When an answer sounds optimistic, name the failure mode.
- When competition is dismissed too easily, push back.
- When the target audience is vague, make it concrete and stress-test it.
- When the moat is weak, say so.
- When evidence is thin, treat it as thin.
- When MVP scope keeps growing, flag it.

## Interview Dimensions

Work through these in order; skip or combine when the codebase already answers them.

**1. The idea**
- What is the product? One clear sentence.
- What problem does it solve, and for whom?
- Why now? What's changed that makes this viable today?

**2. Target audience**
- Who is the primary user? (role, context, frustration)
- Who is the ideal early adopter — the person who needs this so badly they'll forgive rough edges?
- How large is this segment? Is it growing or shrinking?
- How are they solving this problem today?

**3. Market & competition**
- Who are the direct and indirect competitors?
- What are their biggest weaknesses or blind spots?
- What does this product do that nothing else does well?
- Is this a new market or displacing an existing solution?

**4. Value & differentiation**
- What is the single most important thing this product does?
- Why would a user switch from their current solution?
- What makes this defensible over time — moat, network effects, switching costs, brand?

**5. Validation**
- What evidence exists that users want this?
- What's the riskiest assumption, and what would falsify it?
- What would it take to get 10 users? 100?

**6. Features**
- What is the absolute minimum to deliver the core value?
- What features are table stakes vs. genuine differentiators?
- What would make users pay, refer others, or come back daily?

**7. UX & Design**
- What does the core user workflow look like, step by step?
- Where do users typically drop off or get confused in similar products?
- What design patterns or interaction models does the target audience already know?
- What is the right visual register — minimal, rich, power-user, consumer?
- What would a "delightful" moment in this product feel like?

## Step 3: Report

After the interview, produce a report with these sections:

### Audience
Who this is for, who the early adopter is, and why they care.

### Market Positioning
Where this sits in the landscape, what category it competes in, and what the key differentiation is.

### Competitive Analysis
Top 3–5 competitors, their strengths and weaknesses, and the gap this product fills.

### Direction Assessment
A clear verdict (go / conditional go / no-go) with 2–3 reasons. If conditional, state what needs to be true. For an existing product, frame this as the recommended next direction.

### Prioritized Feature Backlog
- **Must-have** — without these, the product doesn't exist
- **Should-have** — needed to win against alternatives
- **Nice-to-have** — adds value but not on the critical path

### UX & Design Direction
The recommended core user workflow. Key design patterns and interaction model. What the product should feel like to use.

### Key Risks
The 2–3 assumptions most likely to be wrong, and how to test them cheaply.

## Step 4: Write docs

Spawn a subagent to write all product docs. Pass the full report as context in the subagent prompt — it cannot read the conversation.

### Gitignore check

Before writing any file, check whether `.harness/` is covered by `.gitignore`. If not, add it:
```
echo '.harness/' >> .gitignore
```
Only add it if the entry isn't already present.

### Document rules

- All files go under `.harness/product/`. Create the directory if it doesn't exist.
- Update existing files rather than overwrite.
- Omit any section not covered in the report rather than inventing content.
- **Never link to `.harness/` files from any public document** (README.md, CHANGELOG.md, CONTRIBUTION.md, LICENSE, DESIGN.md).

**.harness/product/product.md**
```
# [Product Name]

## What it is
One paragraph. What it does, who it's for, the problem it solves.

## Audience
Primary user and their context. Who the early adopter is and why they care.

## Positioning
What category this competes in. The single most important differentiator.

## Direction Assessment
Verdict and 2–3 reasons. If conditional: what needs to be true.

## Key Risks
Top 2–3 assumptions most likely to be wrong, and how to test them.
```

**.harness/product/roadmap.md**
```
# Roadmap

## Must-have
- [ ] Feature — one-line rationale

## Should-have
- [ ] Feature — one-line rationale

## Nice-to-have
- [ ] Feature — one-line rationale
```

**.harness/product/competitors.md**
```
# Competitive Analysis

## [Competitor]
What they do well. Where they fall short. Why users switch away.

## Gap this product fills
One paragraph on the unmet need and why now.
```

**.harness/product/ux.md** *(only if UX or design direction was discussed)*
```
# UX & Design Direction

## Core workflow
The primary user journey, step by step.

## Interaction model
What design patterns and conventions this product follows.

## Design register
The visual and interaction register. What "delightful" means for this product.

## Key UX decisions
The 2–3 workflow or design choices that most affect the build.
```

After the subagent finishes, confirm every file written with a one-line summary of what changed.
