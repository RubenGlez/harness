---
name: dev-plan
description: Analyze product docs and the codebase to decide architecture, tech stack, and implementation approach, then generate a technical spec for every must-have feature. Use after product-plan to bridge the product vision into a buildable engineering plan.
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
- Read README.md and AGENTS.md for stated architecture and setup
- Identify the tech stack already in use (languages, frameworks, databases, key libraries)
- Scan key directories to understand what's built, what's stubbed, what's absent
- Check `.harness/engineering/` and `.harness/adr/` to avoid re-deciding settled questions

Synthesize into an internal picture: what needs to be built, what constraints exist, where the real decisions are. Do not share this — use it to skip obvious questions.

## Step 2: Interview

Interview the user one question at a time. For every question, lead with your recommendation first — state what you'd choose and why, then ask if they agree. Never ask a bare question.

Be direct about tradeoffs. When a choice has real costs, name them. When a popular tool is the wrong fit, say so. When the user's preference conflicts with what the product needs, surface that conflict.

If a question can be answered by reading the codebase or product docs, answer it yourself and move on.

Work through these dimensions in order; skip or combine when the answer is already clear. See [REFERENCE.md](REFERENCE.md) for detailed questions per dimension:

1. Architecture
2. Tech stack
3. Key libraries and tools
4. Data model
5. Implementation approach
6. Constraints
7. Visual design *(UI projects only)*
8. Key tradeoffs

## Step 3: Engineering Summary

After the interview, produce:

- **Architecture**: one paragraph on the chosen structure and why
- **Stack**: language, framework, database, key libraries — with rationale for each
- **Implementation approach**: build new / extend / refactor, and the phase order
- **Visual design tokens**: palette, type system, spacing scale, component tokens (if UI)
- **Key decisions**: the 2–3 choices that constrain everything else
- **Open questions**: anything unresolved that affects what gets built

## Step 4: Write docs

Spawn three subagents in parallel. Pass the full engineering summary as context — subagents cannot read the conversation.

**Run them in your own checkout — never with worktree isolation.** `.harness/` is gitignored, so their doc edits don't register as git changes; an isolated worktree is judged "unchanged" and auto-cleaned on exit, silently discarding the work. In your checkout, their writes land in the real `.harness/`. (A, B, and C write different files, so there is no parallel-edit conflict that would call for isolation.)

Rules: all internal files go under `.harness/`; update existing rather than overwrite; omit sections not covered in the summary; never link to `.harness/` from public docs.

**Subagent A** — writes `.harness/engineering/architecture.md` and `DESIGN.md` (UI only).
**Subagent B** — writes `.harness/engineering/implementation-plan.md` and ADRs.
**Subagent C** — writes one `.harness/engineering/features/[slug].md` per must-have feature.

See [REFERENCE.md](REFERENCE.md) for the exact template each subagent uses.

After all subagents finish, confirm every file written with a one-line summary. Recommend: "Run /implement to build Phase 1 features."
