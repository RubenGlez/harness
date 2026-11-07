# Subtract before you add

**When:** sizing a change, a refactor or a new feature.

Bias to the smallest change that solves the problem, and to deletion.

- Remove dead code, redundant checks and stale stubs in the area first, then build on the simpler base.
- No new layer, wrapper or option unless a second caller needs it today.
- When a diff grows past what the request implies, stop and look for the shorter path.

This is about the code you touch. Unrelated cleanup still waits for its own change (see "Surgical Changes").
