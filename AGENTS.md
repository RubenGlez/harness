# Harness

This repo intentionally uses npm (not pnpm, despite the global rule): `setup.sh` is an installer that must run on a fresh machine where only Node and its bundled npm exist.

`.harness/` is gitignored, so it never travels through git into worktrees or merges. Two mechanisms compensate: the `harness-seed-worktree` SessionStart hook copies `.harness/` (plus a pristine `.harness/.base/` snapshot) into any manually-created worktree, and `/update-docs` reconciles a worktree's docs back to main against that base, gated on user approval. `/implement` subagents run in worktrees without `.harness/`, so the orchestrator passes context inline and is the sole reader/writer of `.harness/`.

**Never spawn a `.harness/`-writing subagent with worktree isolation.** Because `.harness/` is gitignored, its edits don't register as git changes, so an isolated worktree is judged "unchanged" and auto-cleaned on completion — silently discarding the agent's doc output. Doc-writing subagents (`/dev-plan` Step 4, `/update-docs` Step 2) must run in the orchestrator's own checkout, where their writes land in the real `.harness/`. `/implement` sidesteps this entirely: its subagents never write `.harness/` — they report results and the orchestrator writes.

## Verification contract

`/implement` slices are verified by static checks only (typecheck, build, lint). Behavioral verification and cross-feature integration testing are deferred to `/qa` by design — this keeps parallel slices fast and collision-free (no competing servers, ports, or fixtures across worktrees). The consequence is intentional: a feature marked `done` by `/implement` has compiled but not necessarily executed; `/qa` is the first time acceptance criteria are exercised. Do not add behavioral verification to subagent prompts.

## Release

This is a Claude Code plugin distributed via the git marketplace (no npm publish; `package.json` is `private`). To release: bump `version` in `.claude-plugin/plugin.json`, commit, create an annotated `vX.Y.Z` tag, and push branch + tag. The tag is the release marker — there is no external deploy step.
