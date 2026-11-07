# Sequence verifiable units

**When:** multi-step work: migrations, sweeps, a run of similar edits, a stack of commits or PRs.

Break the work into small units that each end in a state you can check. Check each one before starting the next.

- Each unit is a commit that builds and passes its check on its own.
- Order units so the sequence explains itself to a reviewer: structure first, behavior after.
- A failing unit stops the line. Don't pile the next unit on top of a red one.
