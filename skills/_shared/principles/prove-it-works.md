# Prove it works

**When:** before you call any task done.

Check the real artifact, not a proxy. Run the feature, read the actual value, inspect the actual diff. "It compiles", a subagent's "done", a cached screenshot or a file's mtime are not proof.

- Observe the thing itself: the process is alive, the row exists, the page shows the text.
- When a check fails, suspect the check first (wrong surface, stale build, wrong env), then the code.
- Prefer a script you can rerun over a one-off look. Keep its output so a reviewer can rerun it instead of trusting you.
- "Inconclusive" or "checked on a different surface" is not a pass. Say so.

A skill's own verification contract still wins: `/implement` stops at static checks on purpose and `/qa` does the proving.
