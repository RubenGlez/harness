# Implement — Reference

## Subagent Prompt Contents

Subagents start with no conversation context but can read the repo. Paste only the feature spec; pass everything else as paths to read. Each subagent prompt must include:

**1. Feature spec** *(pasted in full)*
The complete content of this feature's `.harness/engineering/features/[slug].md`. This is the one document the subagent must follow exactly.

**2. Context docs** *(paths, with a read instruction)*
```
Before writing any code, read these files:
- .harness/engineering/architecture.md — stack, components, data flow, constraints
- .harness/product/CONTEXT.md — domain vocabulary (if it exists)
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
- Use the domain vocabulary exactly as defined in CONTEXT.md for all identifiers
- When done, update the Status line in the feature spec file from `planned` to `done`
  and add a brief implementation note describing what was built
- If you cannot complete the feature: set Status to `blocked` and explain exactly what's missing
```

Do not share other features' specs with a subagent unless the spec explicitly lists them as dependencies.

If running in an environment where subagents lack file access, fall back to embedding the full content of the context docs (item 2) and needed files instead of paths.
