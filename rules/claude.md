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

## Documentation
- After any significant code change (new feature, API change, config change, removed functionality), update the relevant docs to reflect the new state
- Docs include README files, inline JSDoc/comments that describe behavior, and any docs/ or wiki directories in the repo
- Don't add docs that don't exist yet unless asked; focus on keeping existing docs accurate
- Don't include anything that can be inferred by reading the code; only document the non-obvious
- Don't duplicate information that exists elsewhere in the docs
- Don't reveal internal reasoning, conversation context, or agent decision-making; docs should read as if written by a human author

## Verification
- After creating or modifying anything, always verify it works; never report a task as done without testing it
- Run all available static checks: linting, typechecking, and the test suite
- Go beyond static checks: use MCP tools, browser skills, simulator/emulator tools, or any available capability to test the feature where it actually runs
- For browser apps, use the Playwright MCP to navigate, interact, and assert behavior in a real browser
- For mobile apps, use Argent MCP to test on iOS simulator or Android emulator
- If a runtime environment is available (browser, simulator, emulator, terminal app), use it; don't skip it just because static checks passed

## Tools
- Always use Context7 for library and API documentation, code generation, setup, or configuration steps — without me explicitly asking

@RTK.md
