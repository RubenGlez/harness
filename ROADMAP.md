# Dashboard Roadmap

This roadmap covers the parallel dashboard MCP and its local UI. It focuses on the control plane around long-running work, not on the main orchestrator itself.

## Phase 1 - Observability
- Current status overview for pipelines, workers, and blockers.
- Local dashboard launcher that opens in the default browser.
- Automatic shutdown after one minute of inactivity when nothing is running.
- Repo filtering and log tails for quick inspection.

## Phase 2 - Operational Control
- Cancel a running pipeline from the dashboard.
- Terminate an individual worker.
- Clean up completed worker worktrees.
- Add explicit action confirmations for destructive operations.

## Phase 3 - Review Surface
- Show edited files and diffs per worker or stage.
- Jump from a pipeline to the relevant working tree or changed file.
- Surface concise summaries of what each stage changed.

## Phase 4 - Inline Feedback
- Add inline comments on changed code.
- Track comment status and resolution state.
- Keep review comments tied to a specific pipeline or worker run.

## Phase 5 - Navigation and History
- Search past runs by repo, worker, or pipeline id.
- Show a recent execution history view.
- Add lightweight event streaming or live refresh when useful.

## Notes
- The dashboard stays a separate MCP so it can be removed without affecting the main orchestrator.
- Anything that changes execution behavior belongs in the orchestrator, not the dashboard.
