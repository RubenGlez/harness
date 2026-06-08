# Product Plan — Reference

## Interview Dimensions

### 1. The idea
- What is the product? One clear sentence.
- What problem does it solve, and for whom?
- Why now? What's changed that makes this viable today?

### 2. Target audience
- Who is the primary user? (role, context, frustration)
- Who is the ideal early adopter — the person who needs this so badly they'll forgive rough edges?
- How large is this segment? Is it growing or shrinking?
- How are they solving this problem today?

### 3. Market & competition *(skip if idea.md already covers this)*
- Who are the direct and indirect competitors?
- What are their biggest weaknesses or blind spots?
- What does this product do that nothing else does well?
- Is this a new market or displacing an existing solution?

### 4. Value & differentiation
- What is the single most important thing this product does?
- Why would a user switch from their current solution?
- What makes this defensible over time — moat, network effects, switching costs, brand?

### 5. Validation
- What evidence exists that users want this?
- What's the riskiest assumption, and what would falsify it?
- What would it take to get 10 users? 100?

### 6. Features
- What is the absolute minimum to deliver the core value?
- What features are table stakes vs. genuine differentiators?
- What would make users pay, refer others, or come back daily?

### 7. UX & Design
- What does the core user workflow look like, step by step?
- Where do users typically drop off or get confused in similar products?
- What design patterns or interaction models does the target audience already know?
- What is the right visual register — minimal, rich, power-user, consumer?
- What would a "delightful" moment in this product feel like?

---

## Document Templates

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

**.harness/product/CONTEXT.md** — the canonical domain vocabulary. Single source of truth for how all subsequent skills name things in code, docs, and conversations.
```
# Domain Glossary

## [Term]
[Precise one-sentence definition: what it IS in this product, not what it does]
```

Include every term that: could be confused with a similar concept; has a product-specific meaning; or was explicitly defined or debated during the interview. Do not add self-evident terms. Update immediately whenever a term is defined or sharpened — do not batch updates.
