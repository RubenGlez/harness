---
name: ideate
description: Research a product idea on the web to assess market viability, identify competitors, and produce a go/no-go verdict. Use as the very first step when you have a new product idea, before product-plan.
---

# Ideate

## Step 1: Capture the idea

If the user has already described their idea in the conversation, use that. Otherwise ask one question:

> "Describe the product you want to build in one sentence — what it does and who it's for."

Do not ask follow-up questions. Move straight to research.

## Step 2: Research

Search the web systematically. Read the top results in full for each search — don't skim.

**Competitor discovery**
- Search `[keyword] app`, `[keyword] tool`, `[keyword] software`
- Search `[keyword] site:producthunt.com`, `[keyword] site:github.com`
- Search `best [keyword] alternative`, `open source [keyword]`
- For each competitor found: what it does, who it targets, pricing model, main limitation, approximate user base or GitHub stars

**User pain signals**
- Search `[keyword] reddit`, `[keyword] site:news.ycombinator.com`
- Look for "I wish [existing tool] could...", "why is there no tool that..."
- Note the recurring complaints users have with existing solutions — these are the real gaps

**Market saturation**
- How many serious competitors exist? Are they well-funded, indie, or abandoned?
- Is the open-source space active (recent commits, high stars) or stale?
- Are there multiple funded startups? One dominant player? A fragmented market?

## Step 3: Synthesize

Assess across four dimensions:

**Saturation** — how crowded is the space? Is it dominated by one player, fragmented, or wide open?

**Gap** — what do users consistently complain about that no existing solution addresses? Be specific.

**Differentiation potential** — what angle could give this product a real edge — not a marginal improvement but a meaningfully different approach?

**Viability** — is the problem real, frequent, and worth solving? Would people pay for it, use it daily, or recommend it?

Produce a verdict:
- **go** — clear gap, realistic differentiation, winnable path
- **conditional go** — opportunity exists but depends on specific assumptions being true; name them
- **no-go** — saturated, no clear gap, or problem not strong enough to build on

## Step 4: Write docs

### Gitignore check
Before writing, check whether `.harness/` is in `.gitignore`. If not, add it:
```
echo '.harness/' >> .gitignore
```
Only add if not already present.

### Write `.harness/product/idea.md`

Create the directory if it doesn't exist.

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
| [name]   | ...         | ...           | ...              |

### Market saturation
[low / medium / high] — one paragraph on why.

### User pain signals
The recurring complaints found in forums, communities, and discussions.

### Opportunity
The specific gap that exists and why existing solutions don't fill it.

## Viability assessment

**Verdict**: go / conditional go / no-go

**Reasons**
1. ...
2. ...
3. ...

**Key assumptions to validate**
- [assumption] — how to test it cheaply

## Sources
- [URL] — what it contributed to the analysis
```

After writing, share the verdict and key findings with the user. Recommend the next step:
- go / conditional go: "Run /product-plan to define the full product vision."
- no-go: explain what would need to change to reconsider.
