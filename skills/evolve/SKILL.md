---
name: evolve
description: Define what to add, change, or extend on an existing product through a product-level interview, then update the harness docs and hand off to dev-plan. Use when the user wants to add a feature, modify behavior, or introduce nuances to an existing product — not a small tweak (use /task for that) and not a brand new product (use /ideate for that).
---

# Evolve

A focused product conversation that answers "what exactly are we changing and why" before any engineering begins. Output is updated harness docs, ready for `/dev-plan`.

## Step 1: Capture the intent

The user has already described what they want — use that. If the description is too vague to work from, ask one question:

> "Describe the change in one sentence — what it does and why you want it."

Do not ask multiple clarifying questions upfront. One question, then proceed to reading context.

## Step 2: Read the context

Before the interview, read everything available about the existing product:

- `.harness/product/product.md` — what the product is and who it's for
- `.harness/product/roadmap.md` — what's planned, what's done, what's deferred
- `.harness/product/ux.md` — existing UX workflows and design direction
- `.harness/product/competitors.md` — competitive landscape
- `.harness/product/CONTEXT.md` — domain vocabulary; use these exact terms throughout

Also scan the codebase briefly: README.md, AGENTS.md, and the feature surface (routes, screens, commands, or key modules) to understand what's already built.

Synthesize into an internal picture: what the product currently does, who it serves, and how the user's request fits (or doesn't) into what already exists. Use this to skip obvious questions and form sharp hypotheses before the interview.

## Step 3: Interview

Interview the user grill-me style — one question at a time, never batching. For every question, lead with your own position first: state a concrete hypothesis or recommendation, then ask the user to react to it. Never ask a bare question.

**Be a realist.** Name scope creep when you see it. Push back on vague answers. Make abstract benefits concrete. If the change risks diluting the product's focus, say so.

Work through these dimensions in order; skip any already answered by the context you read or the user's initial description. See [REFERENCE.md](REFERENCE.md) for detailed questions per dimension:

1. The change
2. Audience fit
3. Product fit
4. Scope
5. Competitive angle
6. UX impact
7. Roadmap priority

## Step 4: Report

After the interview, produce a concise report:

- **The change** — one clear sentence defining what is being added or modified
- **Why it fits** — how this serves the audience and reinforces the product's positioning
- **Scope** — what's included and what's explicitly out of scope
- **UX impact** — how it fits into existing workflows, or what changes
- **Roadmap placement** — must-have / should-have / nice-to-have, and which phase
- **Open questions** — anything unresolved that `/dev-plan` should address

## Step 5: Update docs

Update only what changed. Do not rewrite docs that weren't affected.

- **`.harness/product/roadmap.md`** — always: add a new entry or update an existing one to reflect the agreed scope and priority. Use the format already in the file.
- **`.harness/product/ux.md`** — only if the change affects UX workflows or design direction.
- **`.harness/product/CONTEXT.md`** — only if new domain terms were defined or sharpened during the interview.

After writing, confirm each file updated with a one-line summary.

Recommend: "Run /dev-plan to define the architecture and generate the feature spec."
