---
name: qa
description: Test implemented features against their acceptance criteria using available tools (Playwright for web apps, shell for CLI/API, test runner for libraries). Fixes simple failures directly. Documents all results in .harness/qa/report.md. Use after implement has finished a phase.
---

# QA

## Step 1: Read the context

Read:
- `.harness/engineering/features/` — acceptance criteria for every `done` feature
- `.harness/product/ux.md` — core user workflows to validate end-to-end
- `CLAUDE.md` and `README.md` — how to install and run the project
- `package.json` / `pyproject.toml` / `Makefile` / `go.mod` — available test and run commands

Determine:
- **Project type**: web app, CLI, REST API, library, mobile
- **How to start the app**: the exact command(s)
- **What testing tools are available**: existing test suite, Playwright MCP, shell

Do not start testing until you can start the app or run the test suite.

## Step 2: Run existing tests

If a test suite exists, run it first:
```
npm test / pytest / go test ./... / cargo test / bundle exec rspec
```

Record: total / passing / failing. Do not stop here — automated unit tests rarely cover full acceptance criteria from a user perspective.

## Step 3: Test each feature

Work through every `done` feature in `.harness/engineering/features/`. For each, verify every acceptance criterion.

**Web app — use Playwright:**
- Start the app
- Walk through the user flow from `.harness/product/ux.md` relevant to this feature
- Interact with the UI to verify each criterion
- Check edge cases listed in the feature spec (empty states, error states, validation)

**CLI — use shell:**
- Run the commands described in the feature spec with the expected inputs
- Verify stdout/stderr matches expected output
- Test error paths (bad input, missing files, etc.)

**REST API — use shell / curl:**
- Make requests to each endpoint described in the spec
- Verify status codes, response shapes, and error responses
- Test auth, validation, and edge cases

**Library — write and run a small usage script:**
- Exercise each public API described in the spec
- Verify return values and thrown errors

For each criterion: record ✅ pass or ❌ fail with a one-line note on what was observed.

## Step 4: Fix simple failures

For each ❌ failure:

1. Read the relevant source code
2. Identify the root cause
3. Apply a fix if all of these are true:
   - The fix touches fewer than ~30 lines
   - It's contained to one or two files
   - The cause is clear (typo, wrong condition, missing null check, off-by-one)
4. Re-run the specific test to confirm the fix works
5. If the fix is complex, cross-cutting, or requires design decisions: mark it `outstanding` — do not guess

**Never fix a failure by weakening the acceptance criterion or removing the test.**

## Step 5: Write the QA report

Write `.harness/qa/report.md`. Create the directory if it doesn't exist.

```
# QA Report — [YYYY-MM-DD]

## Summary
- Features tested: N
- All criteria passed: N
- Criteria with failures: N
- Failures auto-fixed: N
- Outstanding issues: N

## Results by feature

### [Feature name]
- ✅ [Criterion] — [brief note on how it was verified]
- ✅ [Criterion] — ...
- ❌ [Criterion] — [what was observed] — **fixed**: [yes / no]

## Outstanding issues

### [Issue title]
**Feature**: [name]
**Criterion**: [which acceptance criterion failed]
**Failure**: [what went wrong]
**Root cause**: [if known]
**Required fix**: [what needs to happen to resolve this]
```

## Step 6: Recommend next step

After writing the report:

- **All criteria passing**: "QA passed. Run /update-docs to wrap up."
- **Failures fixed, none outstanding**: "Fixed [N] failures. Run /qa again to confirm."
- **Outstanding issues**: summarise what needs attention and whether it blocks shipping.
