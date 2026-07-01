---
name: prototype
description: Build throwaway code to answer a specific design question before committing to an implementation approach. Use when a feature has high technical uncertainty — you don't know if an approach will work, which library fits, or what the state machine looks like.
---

# Prototype

## Step 1: Define the question

Before writing any code, state the design question in one sentence:
> "Can [approach] handle [constraint] at [scale]?"
> "Which of [option A] / [option B] produces [outcome]?"
> "What does the state machine look like when [edge case] happens?"

If the question can't be written in one sentence, the prototype is too broad — narrow it first.

Read the relevant `.harness/engineering/features/[slug].md` to understand the full feature context, then surface the specific uncertainty that needs answering.

Confirm the question with the user before proceeding.

## Step 2: Choose the approach

| Question type | Approach |
|---|---|
| Logic / state machine / business rules | Interactive terminal app — simulate inputs, display full state after each action |
| Visual / UX / layout | Multiple UI variations on one route, toggled via `?variant=a` / `?variant=b` |
| Library / external integration | Minimal single-file script that exercises the specific capability |
| Performance / data volume | Benchmark harness with representative data sizes |

## Step 3: Build it

Rules — these are not optional:
- **Mark as temporary**: name files `_prototype-[slug]` or place in a `_spike/` folder near the target location
- **Single entry point**: one command to run, matching the project's existing conventions
- **In-memory state**: no persistence unless the prototype specifically tests database behaviour
- **Speed over quality**: no tests, no abstractions, minimal error handling
- **Expose state changes**: display full state after every action so every finding is visible
- **No shared code**: do not extract from or integrate into production code

Do not refactor the prototype. Do not make it "production-ready." It exists only to answer the question.

## Step 4: Run and observe

Run the prototype. Work through the scenarios that exercise the question. Note:
- The answer to the design question
- What surprised you (constraints, edge cases, or behaviour that wasn't obvious from the spec)
- Whether the approach is viable

Share findings with the user before writing anything to `.harness/`.

## Step 5: Capture and clean up

**Approach is viable:**
1. Update the feature spec's Technical approach section in `.harness/engineering/features/[slug].md` with what the prototype revealed — be specific about what works and any constraints discovered
2. If the finding resolves a genuine architectural trade-off (hard to reverse + surprising without context + real alternatives existed): write an ADR to `.harness/adr/NNNN-[slug].md`
3. Delete ALL prototype code — including `_spike/` folders and `_prototype-*` files
4. If the prototype revealed reusable patterns, describe them in prose in the ADR or feature spec — do not keep the prototype code as a reference
5. Commit the spec/ADR updates: `git add .harness && git commit -m "docs: capture prototype findings"` — worktrees and future sessions only see committed `.harness/` content

**Approach is not viable:**
1. Update the feature spec: document what was tried and why it failed
2. Propose an alternative approach to the user
3. Delete ALL prototype code
4. Commit the spec update: `git add .harness && git commit -m "docs: capture prototype findings"`

After cleanup, confirm:
- What was written to `.harness/`
- That prototype code has been deleted (list the deleted paths)
- What the recommended next step is: `/prototype` again with a new question, or `/implement` if the design is now clear
