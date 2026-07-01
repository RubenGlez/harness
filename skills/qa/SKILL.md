---
name: qa
description: Test implemented features against their acceptance criteria, fix simple failures, and write a QA report. Use after implement has finished a phase, or when you want to verify that implemented features work as specified.
---

# QA

## Core principle

Tests verify behavior through public interfaces, not implementation details. Code can be refactored entirely; tests should not break unless behavior changes. If a test breaks when you rename an internal function but the user-facing behavior is unchanged, the test was wrong.

When writing test steps or evaluating failures, always ask: "Is this testing what the user experiences, or what the code looks like inside?"

## Step 1: Read the context

Read:
- `.harness/engineering/features/` — acceptance criteria for every `done` feature
- `.harness/product/ux.md` — core user workflows to validate end-to-end
- `AGENTS.md` and `README.md` — how to install and run the project
- `package.json` / `pyproject.toml` / `Makefile` / `go.mod` — available test and run commands

Determine:
- **Project type**: web app, CLI, REST API, library, mobile
- **How to start the app**: the exact command(s)
- **What testing tools are available**: existing test suite, Playwright MCP, shell

## Step 2: Build a feedback loop

Before running any test, identify the fastest, most deterministic signal for each feature. A good feedback loop is: fast (seconds, not minutes), deterministic (same result every run), and sharp (clearly signals pass or fail).

Work through this list in order — use the first approach that fits:

1. **Failing test** — does an existing test already cover this criterion? Run it.
2. **curl / HTTP script** — for API features, a one-liner that hits the endpoint and checks the response
3. **CLI with fixtures** — for CLI features, run the command with a known input and diff the output
4. **Headless browser** — for web features, Playwright with the shortest possible script
5. **Minimal harness** — write a 10-line script that exercises the specific behavior in isolation

For each feature, decide which approach gives the clearest signal before proceeding to Step 3.

If a criterion is flaky (non-deterministic): do not mark it as passing. Investigate the source of flakiness — it is almost always a real bug or missing synchronisation, not noise to ignore.

## Step 3: Run existing tests

If a test suite exists, run it:
```
npm test / pytest / go test ./... / cargo test / bundle exec rspec
```

Record: total / passing / failing. Note which features each failing test relates to. Do not stop here — test suites rarely cover full acceptance criteria from a user perspective.

## Step 4: Test each feature

Work through every `done` feature in `.harness/engineering/features/`. For each, verify every acceptance criterion using the feedback loop identified in Step 2.

**Web app — use Playwright:**
- Start the app
- Walk through the user flow from `.harness/product/ux.md` relevant to this feature
- Verify behavior through the UI, not by inspecting internal state or database records directly
- Check edge cases from the feature spec (empty states, error states, validation messages)

**CLI — use shell:**
- Run commands with the inputs described in the spec
- Verify stdout/stderr matches expected output for both happy path and error paths
- Do not test by reading internal files the user wouldn't access

**REST API — use shell / curl:**
- Make requests to each endpoint in the spec
- Verify status codes, response shapes, and error responses through the API surface only
- Do not verify by querying the database directly unless the feature's acceptance criterion explicitly requires it

**Library — write and run a usage script:**
- Exercise each public API in the spec through its public interface
- Do not call private methods or inspect internal state

For each criterion: record ✅ pass or ❌ fail with a one-line note on what was observed.

## Step 5: Fix simple failures

For each ❌ failure:

1. Read the relevant source code
2. Identify the root cause
3. Apply a fix if ALL of these are true:
   - The fix touches fewer than ~30 lines
   - It's contained to one or two files
   - The cause is clear (wrong condition, missing null check, typo, off-by-one)
4. Re-run the specific test to confirm the fix works
5. If the fix is complex, cross-cutting, or requires design decisions: mark it `outstanding`

**Never fix a failure by weakening an acceptance criterion or removing a test.**

## Step 6: Write the QA report

Write `.harness/qa/report.md` (create directory if needed). Prepend new reports — keep previous entries below. See [REFERENCE.md](REFERENCE.md) for the template.

Commit the report (with any Step 5 fixes, or on its own): `git add .harness && git commit -m "docs: QA report"` — worktrees and future sessions only see committed `.harness/` content.

The "Architectural gaps" section is the post-mortem. If multiple failures share a root cause (missing abstraction, tight coupling, untested seam), document it there so `/update-docs` can decide whether to open an ADR.

## Step 7: Recommend next step

Outstanding failures (the ones Step 5 didn't fix) need an owning skill — don't leave them as a description for the user to act on. Route each by size:

- **Outstanding failure, small and contained** (one feature, clear cause, no design decision): "Run /task to fix [failure]." `/task` verifies and re-syncs the spec; re-run /qa after.
- **Outstanding failure, cross-cutting or needs design** (spans features, missing abstraction, ambiguous criterion): the feature spec is the problem, not just the code. "Re-spec [feature] via /dev-plan (or /evolve if the behavior itself is in question), then /implement it." Do not hand a vague failure straight to /implement — it will guess.
- A failure never reaches /update-docs or /ship unfixed: shipping with open QA issues is a decision /ship forces you to make, not a default.

Then the standard transitions:

- **All criteria passing, no gaps**: "QA passed. Run /update-docs to wrap up."
- **Failures fixed, none outstanding**: "Fixed [N] failures. Run /qa again to confirm."
- **Architectural gaps found**: "Gaps documented in the report. Consider running /update-docs to record them as ADRs before proceeding."
