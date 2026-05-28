---
name: product-to-docs
description: Turn the current conversation context into product documentation after a /product-fit session. Synthesizes decisions into docs/product/product.md, docs/product/roadmap.md, and docs/product/competitors.md. Use when the user wants to capture product-fit decisions as docs, says "write this up", "save this to docs", or has just finished a product-fit interview.
---

# Product to Docs

Do NOT re-interview the user. Synthesize what you already know from the conversation.

## Step 1: Read the repo

Before writing anything, scan for existing documentation:

- `README.md` — read for context only (user-facing; never modify it)
- `docs/product/` — the target for all output; check for existing product, roadmap, or competitive analysis files to update rather than overwrite

All files go under `docs/product/`. Create the directory if it doesn't exist.

## Step 2: Extract decisions

From the conversation, pull out:

- **Product definition** — what it is, who it's for, the core problem it solves
- **Target audience** — primary user, early adopter, segment size
- **Positioning** — how it sits in the market, what category, key differentiator
- **Go / No-Go verdict** — the assessment and its key reasons
- **Feature backlog** — must-have, should-have, nice-to-have tiers
- **Key risks** — top 2–3 riskiest assumptions
- **Competitive landscape** — main competitors, their weaknesses, the gap this fills

If the conversation didn't cover a section, omit it rather than inventing content.

## Step 3: Write the docs

### docs/product/product.md

The source of truth for what the product is and why it exists. Use this structure:

```
# [Product Name]

## What it is
One paragraph. What it does, who it's for, and the problem it solves.

## Audience
Primary user and their context. Who the early adopter is and why they care.

## Positioning
What category this competes in. The single most important differentiator.

## Go / No-Go
Verdict (go / conditional go / no-go) and 2–3 reasons.
If conditional: what needs to be true before committing.

## Key Risks
Top 2–3 assumptions most likely to be wrong, and how to test them.
```

### docs/product/roadmap.md

The prioritized feature plan. Use this structure:

```
# Roadmap

## Must-have
Without these, the product doesn't deliver its core value.
- [ ] Feature — one-line rationale

## Should-have
Needed to win against alternatives.
- [ ] Feature — one-line rationale

## Nice-to-have
Adds value but not on the critical path.
- [ ] Feature — one-line rationale
```

### docs/product/competitors.md

Keep this lean. Three to five competitors, one paragraph each:

```
# Competitive Analysis

## [Competitor]
What they do well. Where they fall short. Why users switch away.

## Gap this product fills
One paragraph on the unmet need and why now.
```

## Step 4: Confirm

After writing, list every file you created or updated with a one-line summary of what changed. If a file already existed and you updated it, note what you added vs. what was already there.
