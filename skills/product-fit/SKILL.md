---
name: product-fit
description: Interview the user about a product idea or existing product to assess target audience, market fit, competitive landscape, and feature priority. Produces a full strategy report with a go/no-go verdict and prioritized feature backlog. Use when the user wants to validate a new idea, stress-test product direction, identify what features to build next, or asks about product-market fit, audience analysis, or competitive positioning.
---

# Product Fit

## Step 1: Read the project

Before asking anything, explore the codebase to build a picture of what already exists:

- Read README, CLAUDE.md, or any docs/ directory for stated goals and audience
- Scan the feature surface: routes, screens, commands, or API endpoints
- Check the roadmap or issue tracker if present (roadmap.md, TODO, CHANGELOG, open GitHub issues via `gh issue list`)
- Note what's implemented, what's stubbed, and what's conspicuously absent

Synthesize this into a one-paragraph internal picture of the product: what it does, who it seems built for, and where it appears to be headed. Do not share this summary with the user — use it to skip questions the codebase already answers and to form sharper hypotheses for the questions you do ask.

## Step 2: Interview

Interview the user relentlessly — one question at a time — working through every dimension below. For every question, you must first state a concrete recommendation or hypothesis before asking for their input. Never ask a bare question. Lead with your position — "My read is X. Do you agree?" — so the user is reacting to a specific claim, not filling a blank. Keep pushing until you have enough signal to produce the final report.

Adapt the depth to the stage: a 0→1 idea needs validation focus; an existing product needs competitive and feature-priority focus.

**Be a realist, not a cheerleader.** Your job is to surface the truth, not to validate the user's excitement. Actively play devil's advocate:

- When an answer sounds optimistic, name the failure mode. "That assumes users will change behavior — most won't. Why is this different?"
- When the competition is dismissed too easily, push back. "Notion/Linear/Slack tried this. What happened and why would you win where they struggled?"
- When the target audience is vague, make it concrete and then stress-test it. "You said 'developers' — that's 25 million people. Which 100 would you call this week, and why would they care?"
- When the moat is weak, say so. If it's "we execute better," that's not a moat.
- When evidence is thin, treat it as thin. Anecdotes and friend feedback are not validation.
- When the MVP scope keeps growing, flag it. Scope creep in the interview predicts scope creep in the build.

A comfortable interview produces a flawed strategy. Make the user defend every assumption before it goes into the report.

## Interview Dimensions (Step 2)

Work through these in order, but skip or combine when the codebase already answers them:

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
- What are the competitors' biggest weaknesses or blind spots?
- What does this product do that nothing else does well?
- Is this a new market or displacing an existing solution?

**4. Value & differentiation**
- What is the single most important thing this product does?
- Why would a user switch from their current solution?
- What makes this defensible over time — moat, network effects, switching costs, brand?

**5. Validation**
- What evidence exists that users want this — conversations, waitlist, prototypes, analytics?
- What's the riskiest assumption, and what would falsify it?
- What would it take to get 10 users? 100?

**6. Features**
- What is the absolute minimum to deliver the core value?
- What features are table stakes (must match competitors) vs. genuine differentiators?
- What would make users pay, refer others, or come back daily?

## Step 3: Final Report

After the interview, produce a report with these sections:

### Audience
Who this is for, who the early adopter is, and why they care.

### Market Positioning
Where this sits in the landscape, what category it competes in, and what the key differentiation is.

### Competitive Analysis
Top 3–5 competitors, their strengths and weaknesses, and the gap this product fills.

### Go / No-Go Assessment
A clear verdict (go / conditional go / no-go) with 2–3 reasons. If conditional, state what needs to be true.

### Prioritized Feature Backlog
Three tiers:
- **Must-have** — without these, the product doesn't exist
- **Should-have** — needed to win against alternatives
- **Nice-to-have** — adds value but not on the critical path

### Key Risks
The 2–3 assumptions most likely to be wrong, and how to test them cheaply.
