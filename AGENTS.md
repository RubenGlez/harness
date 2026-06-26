# Harness

This repo intentionally uses npm (not pnpm, despite the global rule): `setup.sh` is an installer that must run on a fresh machine where only Node and its bundled npm exist.

`.harness/` is gitignored, so it never travels through git into worktrees or merges. Two mechanisms compensate: the `harness-seed-worktree` SessionStart hook copies `.harness/` (plus a pristine `.harness/.base/` snapshot) into any manually-created worktree, and `/update-docs` reconciles a worktree's docs back to main against that base, gated on user approval. `/implement` subagents run in worktrees without `.harness/`, so the orchestrator passes context inline and is the sole reader/writer of `.harness/`.

## Release

This is a Claude Code plugin distributed via the git marketplace (no npm publish; `package.json` is `private`). To release: bump `version` in `.claude-plugin/plugin.json`, commit, create an annotated `vX.Y.Z` tag, and push branch + tag. The tag is the release marker — there is no external deploy step.
