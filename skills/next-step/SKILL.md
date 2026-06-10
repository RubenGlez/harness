---
name: next-step
description: Recommends the next harness skill to use by inspecting the repo, docs, git state, and recent work. Use when asking what to do next, which skill comes next, or when the workflow phase is unclear.
---

# Next Step

## Purpose

Recommend the most likely next harness skill, with a short explanation and confidence level. Do not carry out the recommended skill unless the user explicitly asks you to switch to it.

## What to inspect

Read the smallest set of sources that can explain the current project state:
- `AGENTS.md`
- `README.md`
- `.harness/` if it exists, especially product, engineering, and QA docs
- `git status`, recent commits, and any obvious changed files
- package or build files that describe the current stack

If the repo has no `.harness/` docs, infer the phase from the codebase and README.

## Recommendation rules

Prefer the lowest unfinished step in the harness workflow:
- No validated idea or target user -> `/ideate`
- Idea exists, but vision is missing -> `/product-plan`
- Vision exists, but architecture or stack is unresolved -> `/dev-plan`
- Architecture is unclear only for one risky choice -> `/prototype`
- Specs exist and implementation is ready -> `/implement`
- Code changed and needs verification -> `/qa`
- Docs are stale after code changes -> `/update-docs`
- QA passed and docs are current, but the phase isn't released -> `/ship`
- Shipped product needs a small fix, tweak, or micro-feature -> `/task`
- Existing docs are scattered or outside harness structure -> `/migrate-docs`
- Context is fragmented and a fresh agent would struggle -> `/handoff`
- You need a broader map of the area before changing code -> `/zoom-out`

If multiple skills fit, choose the one that removes the biggest blocker first.

## Output format

Return:
1. Recommended skill
2. Why it is the best next step
3. Evidence that led to the recommendation
4. Confidence: high / medium / low
5. One fallback skill if the recommendation is uncertain

Keep the answer short and direct.

## Example

> **Recommended**: `/qa`
> **Why**: Phase 1 features are marked `done` in `.harness/engineering/features/` but no QA report exists yet.
> **Evidence**: `git log` shows 8 commits since the last `/implement` run; `.harness/qa/report.md` is absent.
> **Confidence**: high
> **Fallback**: `/update-docs` if the acceptance criteria turn out to already be verified.
