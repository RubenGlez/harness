---
name: review-diff
description: Two-axis review of the changes since a fixed point (commit, branch, tag, merge-base). Standards checks the diff against the repo's documented conventions plus a code-smell baseline; Spec checks it against the feature specs it claims to implement. Both run as parallel subagents and are reported side by side. Use when the user wants to review a branch, a PR, work in progress, or "review since X", and when /implement closes a phase.
---

# Review diff

Two separate questions about one diff:

- **Standards**: does the code follow this repo's documented conventions?
- **Spec**: does the code do what its feature spec asks, no more and no less?

A change can pass one and fail the other, so they run in separate subagents and are never merged into one ranked list. This is a read-only review: it reports, it doesn't fix. For behavioral bugs, use [/interrogate](../interrogate/SKILL.md).

## Step 1: Pin the fixed point

Use what the user named. Otherwise use the merge base with the default branch. Resolve it (`git rev-parse <ref>`) and confirm `git diff <ref>...HEAD` is non-empty before spawning anything; a bad ref or empty diff stops here. Note the diff command and `git log <ref>..HEAD --oneline`.

## Step 2: Find the sources

**Spec**, in order: a path the user passed; the sections of `.harness/engineering/features.md` that match the commit messages, branch name or touched files; issue references in commit messages (`#123`). None found → the Spec axis reports "no spec available".

**Standards**: `AGENTS.md`, `CONTRIBUTING.md`, `CODING_STANDARDS.md`, `.harness/adr/`, and any other file that says how code here should be written. Also use the exact terms in `.harness/product/CONTEXT.md` if it exists. On top, always apply the smell baseline in [REFERENCE.md](REFERENCE.md). Repo standards override the baseline, and anything a linter or typechecker already enforces is skipped.

## Step 3: Spawn both reviewers in parallel

One message, two Agent calls (`subagent_type: general-purpose`), each with a fresh context and file paths rather than pasted files. Each gets the diff command, the commit list and its sources, plus its brief from [REFERENCE.md](REFERENCE.md). Tell both: read-only, don't edit files.

> **Runtime note:** without parallel subagents (e.g. Codex), see [../_shared/runtime-parallelism.md](../_shared/runtime-parallelism.md) and run Spec first, then Standards, writing each report down before starting the next so one axis doesn't color the other.

## Step 4: Report

Present the two reports under `## Standards` and `## Spec`, lightly cleaned, not merged or re-ranked. End with one line: findings per axis and the worst one within each axis. Don't name a single worst finding across both axes.

Spec gaps on a feature marked `done` are the most important output: they mean `/qa` will test something that isn't there. Route them: small and contained → `/task`; unclear spec → `/evolve` or `/dev-plan`.
