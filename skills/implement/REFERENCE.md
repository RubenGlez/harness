# Implement — Reference

## Subagent Prompt Contents

Subagents run in an **isolated git worktree** created from HEAD. `.harness/` is git-tracked (encrypted via doctier) and checks out decrypted, so subagents READ internal docs directly by path — do not paste doc contents into prompts. They must never WRITE `.harness/`: encrypted files cannot line-merge, so the orchestrator is the sole writer. Anything a subagent must see has to be committed before the worktree is created (Step 3 guarantees this for specs). Each subagent prompt must include:

**1. Feature spec** *(by path)*
"Your spec is `.harness/engineering/features/[slug].md`. Read it first and follow it exactly."

**2. Context docs** *(by path)*
```
Read before writing any code:
- .harness/engineering/architecture.md — stack, components, data flow, constraints
- .harness/product/CONTEXT.md (if it exists) — domain vocabulary; use these terms exactly
- AGENTS.md — conventions, naming, patterns, do-not-edit files
```

**3. Codebase orientation** *(short paragraph, not file contents)*
Which directories the feature touches, what already exists that can be reused, and any files siblings in this phase are likely to modify. The subagent reads files itself as it needs them — orient, don't transcribe.

**4. Instructions**
```
Implement the feature described in the spec as a vertical slice:
- Start from the user-facing entry point (UI, CLI command, or API endpoint)
- Trace the path through to the data layer
- Implement only what this specific feature needs at each layer
- Do not implement shared infrastructure unless this feature requires it
- Do not refactor existing code unless the feature cannot work without it
- Read any file before modifying it — other agents may be working in parallel
- Before marking the feature done, run the project's static checks if they exist
  (typecheck, build, lint — e.g. tsc, npm run build, cargo check) and fix what your
  changes broke. Do not run the test suite, start servers, or do behavioral
  verification — /qa owns that.
- If static checks fail for reasons unrelated to your changes, note it in the
  implementation note and continue.
- Use the domain vocabulary exactly as defined in `.harness/product/CONTEXT.md` for all identifiers
- Do NOT edit or commit anything under `.harness/` — it is read-only for you; never
  `git add .harness`. Report results instead: in your final message, state the final
  Status (`done` or `blocked`) and a brief implementation note describing what was
  built (or, if blocked, exactly what's missing). The orchestrator writes these to
  the feature spec after merging your branch.
```

Do not share other features' specs with a subagent unless the spec explicitly lists them as dependencies.
