# Guidelines

> These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

Every changed line should trace directly to the user's request.

## Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Engineering principles

Apply each one when its trigger fires. Harness skills link the full text (`skills/_shared/principles/` in the harness plugin).

- **Prove it works.** Before calling anything done: check the real artifact (run it, read the value, inspect the diff), not a proxy, a self-report or "it compiles".
- **Fix root causes.** When debugging: reproduce first, then trace the symptom to where things first went wrong and fix it there. A guard is a fix only if the state it handles is legitimate.
- **Attack the premise.** After two fixes sharing an assumption fail the same check: write the assumption down and test it directly before a third fix.
- **Subtract before you add.** When sizing a change: smallest diff that solves it; remove dead weight in the area first; no layer without a second caller.
- **Model the domain.** Before writing logic: name the data shape and encode rules in a structure (enum, state machine, table, typed model) instead of scattered conditionals.
- **Sequence verifiable units.** For multi-step work: small units that each end in a passing check, verified before the next.
- **Encode lessons in structure.** When repeating an instruction a second time: make it a type, lint, hook or test instead of more text.
- **Guard the context window.** For bulk reads or large outputs: delegate to a subagent with file paths and keep only its summary.

---

## Coding
- Always use the LTS version of Node.js; prefer nvm over direct installation
- Use pnpm over npm or yarn
- Always install the latest stable version when adding a new library

## Writing
- Use simple language and a casual tone; avoid em-dashes, use commas or semicolons instead
- Be clear and direct; skip intros and outros

## Git
- Never add co-authored-by lines to commit messages or PR descriptions
- Never push to the default branch unless I explicitly ask; work on a branch and open a PR
- Merge a PR only after `gh pr checks <number> --watch --fail-fast` passes; never use `gh pr merge --admin` or `git push --no-verify`

## Documentation
- After any significant code change (new feature, API change, config change, removed functionality), update the relevant docs to reflect the new state
- Docs include README files, inline JSDoc/comments that describe behavior, and any docs/ or wiki directories in the repo
- Don't add docs that don't exist yet unless asked; focus on keeping existing docs accurate
- Don't include anything that can be inferred by reading the code; document durable, non-obvious facts like human decisions, constraints, setup assumptions, and workflow conventions
- Don't duplicate information that exists elsewhere in the docs
- Keep `AGENTS.md` minimal: it carries only durable facts that cannot be inferred from the code, package manifests, or the harness docs; when something would grow it, put the detail in the relevant harness doc instead
- Don't reveal internal reasoning, conversation context, or agent decision-making; docs should read as if written by a human author
- Every project must treat `AGENTS.md` as the canonical agent-facing doc for shared project context
- `CLAUDE.md` in a project should contain only `@AGENTS.md`, so both agents read the same source of truth

## Verification
- After creating or modifying anything, always verify it works; never report a task as done without testing it
- If the active skill or workflow defines its own verification contract, follow that instead — some deliberately scope it (e.g. `/implement` runs static checks only and defers behavioral testing to `/qa`); the checks below are the default when no such contract applies
- Run all available static checks: linting, typechecking, and the test suite
- Go beyond static checks: use MCP tools, browser skills, simulator/emulator tools, or any available capability to test the feature where it actually runs
- For browser apps, use the Playwright MCP to navigate, interact, and assert behavior in a real browser
- For mobile apps, use Argent MCP to test on iOS simulator or Android emulator
- If a runtime environment is available (browser, simulator, emulator, terminal app), use it; don't skip it just because static checks passed

## Tools
- Always use Context7 for library and API documentation, code generation, setup, or configuration steps — without me explicitly asking
