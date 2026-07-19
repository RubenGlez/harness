# Runtime parallelism

Several skills parallelize work by spawning subagents in isolated git worktrees (`.claude/worktrees/`) through Claude Code's Agent tool. That mechanism is Claude-specific.

If the current runtime can't spawn parallel subagents or create per-agent worktrees (e.g. Codex), do the same work **sequentially in the current session**: process one unit — a feature slice, a doc, a migration target — at a time, top to bottom, then move to the next.

Only the concurrency changes; the structure and the contract do not:

- Vertical slices stay independent and are still done end-to-end, one at a time.
- `.harness/` keeps a **single writer** — you, the orchestrator — so specs never get concurrent edits.
- You still commit `.harness/` doc changes before starting the units and after finishing them.
- Merge/integration steps still run; with sequential work there are simply no sibling branches to reconcile.

The result is slower but identical in outcome, so the skill's acceptance criteria and verification contract are unchanged.
