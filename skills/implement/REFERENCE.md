# Implement — Reference

## Subagent Prompt Contents

Each subagent prompt must include all of the following — subagents have no other context:

**1. Architecture**
Full content of `.harness/engineering/architecture.md`

**2. Feature spec**
Full content of this feature's `.harness/engineering/features/[slug].md`

**3. Domain vocabulary**
Full content of `.harness/product/CONTEXT.md` if it exists. Use these terms exactly in all code: function names, variable names, type names, comments.

**4. Codebase snapshot**
- Directory structure (key directories and files)
- Full content of any files the feature will need to read or modify
- What already exists that can be reused

**5. Conventions**
Full content of `CLAUDE.md`

**6. Instructions**
```
Implement the feature described in the spec as a vertical slice:
- Start from the user-facing entry point (UI, CLI command, or API endpoint)
- Trace the path through to the data layer
- Implement only what this specific feature needs at each layer
- Do not implement shared infrastructure unless this feature requires it
- Do not refactor existing code unless the feature cannot work without it
- Focus on implementation only — do not run the test suite or attempt to verify your work; the /qa skill handles all verification
- Use the domain vocabulary exactly as defined in CONTEXT.md for all identifiers
- When done, update the Status line in the feature spec file from `planned` to `done`
  and add a brief implementation note describing what was built
- If you cannot complete the feature: set Status to `blocked` and explain exactly what's missing
```

Do not share other features' specs with a subagent unless the spec explicitly lists them as dependencies.
