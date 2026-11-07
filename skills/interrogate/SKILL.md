---
name: interrogate
description: Adversarial review of a change or design. Several parallel adversaries try to break it, and only findings proven by a run (failing test, repro script, command output) survive. Reports findings, doesn't fix them. Use when the user says interrogate, adversarial review, stress test this, tear this apart, find blind spots, or before shipping a risky or contested change.
---

# Interrogate

Adversaries try to break a change. A finding counts only when a run proves it. Report; don't fix.

Standalone skill: callable any time. `/qa` also calls it for risky features.

## Step 1: Frame

- **Scope**: what the user names. Otherwise the branch diff from its merge base with the default branch, plus uncommitted changes.
- **Intent**: one or two sentences on what the change must do, from the user's message, commit messages, the PR body and the matching acceptance criteria in `.harness/engineering/features.md`. If the intent is unclear, ask before spawning anything.
- If the scope has uncommitted changes, save them as a patch (`git diff HEAD > <scratch>/interrogate.patch`) so each adversary can apply it.

## Step 2: Fan out

Spawn three adversaries in one message with the Agent tool (`subagent_type: general-purpose`, `isolation: worktree`). Each gets the scope, the intent, the patch path if any, its lens, and the brief below. If the runtime lets you choose models, give one adversary a different model from the others; diverse models find different bugs.

| Adversary | Lens |
|---|---|
| Intent | Does the change actually do what the intent and acceptance criteria say, on every path a user can reach? |
| Inputs | Empty, huge, malformed, unicode, boundary and unexpected-type inputs; error paths and messages. |
| State | Ordering, retries, partial failure, concurrency, stale caches, restarts, idempotency. |

Brief, passed verbatim:

> Break this change. Prove each finding with a run against the real code: a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, probe the current code or build a tiny prototype. Work only in your own worktree. Report each finding as: title, exact command, the output it printed, and the output the intent requires. Leave out anything you did not run, including style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

> **Runtime note:** without parallel subagents (e.g. Codex), see [../_shared/runtime-parallelism.md](../_shared/runtime-parallelism.md) and run the three lenses one after another yourself, in a scratch worktree.

## Step 3: Verify

Rerun each reported command yourself ([prove it works](../_shared/principles/prove-it-works.md)). Keep a finding only if the output shows the failure and the failure breaks the intent. Merge findings that share a root cause. Drop the rest and note why.

## Step 4: Report

- **Intent**: the restatement.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and which adversaries found it. Say "no verified findings" when none survive.
- **Dropped**: per adversary, how many findings were dropped and why (not reproducible, not a break of the intent, style).

Clean up the adversaries' worktrees. Don't apply fixes; if the user wants them, a verified finding is a ready-made repro for `/task`.
