# Implement — Reference

## Subagent Prompt Contents

Subagents run in an **isolated git worktree** that does **not** contain `.harness/` — it is gitignored, and git never copies ignored files into a new worktree. So a subagent cannot read `.harness/` and any edit it made there would not survive the merge. The orchestrator is the only agent with `.harness/`: it pastes everything the subagent needs into the prompt, and it is the only writer of `.harness/`. Each subagent prompt must include:

**1. Feature spec** *(pasted in full)*
The complete content of this feature's `.harness/engineering/features/[slug].md`. This is the one document the subagent must follow exactly.

**2. Context docs** *(pasted in full, not as paths)*
Because the subagent cannot read `.harness/`, embed the relevant content directly:
```
- architecture.md (relevant sections) — stack, components, data flow, constraints
- CONTEXT.md domain vocabulary (if it exists) — use these terms exactly
```
Then point the subagent at the repo files it CAN read:
```
Before writing any code, read AGENTS.md — conventions, naming, patterns, do-not-edit files.
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
- Use the domain vocabulary exactly as defined in the embedded CONTEXT.md terms for all identifiers
- Do NOT edit `.harness/` — it is not in your worktree. Report results instead:
  in your final message, state the final Status (`done` or `blocked`) and a brief
  implementation note describing what was built (or, if blocked, exactly what's missing).
  The orchestrator applies these to the feature spec after merging your branch.
```

Do not share other features' specs with a subagent unless the spec explicitly lists them as dependencies.
