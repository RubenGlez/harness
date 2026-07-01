# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `.harness/` docs are now git-tracked as age-encrypted blobs via
  [doctier](https://github.com/rubenglez/doctier) instead of being gitignored:
  worktrees and clones receive docs through git itself, and doc changes travel
  through normal commits and merges. Entry skills (`/ideate`, `/product-plan`,
  `/migrate-docs`) scaffold `.doctier.yml` on first use; doctier is now a
  prerequisite for the doc-writing skills.
- `/implement` subagents read `.harness/` specs directly from their worktrees
  (no more inline spec pasting); the orchestrator remains the sole writer.
- `/update-docs` maintains a doctier-managed doc index in AGENTS.md
  (`doctier agents --write`).
- `/ship` pre-flight runs `doctier check` when `.doctier.yml` exists.
- Prototype/spike scratch (`_prototype-*`, `_spike/`) is classified as a
  sensitive ephemeral — gitignored by doctier and collected with the worktree.
- doctier policy files (`.doctier.yml`, `.doctier/recipients.txt`,
  `.gitattributes`) are gated by CODEOWNERS per doctier's threat model; the
  bootstrap creates the entries and any diff to them is a security review.

### Removed
- `harness-seed-worktree` and `harness-gitignore` hooks, the `/update-docs`
  worktree-promotion machinery, and the worktree-isolation guardrails — all
  compensated for the gitignored `.harness/` and are obsolete now that docs
  travel through git.

## [0.1.0] - 2026-06-26

Initial release of the harness Claude Code plugin.

### Added
- End-to-end product workflow skills: `/ideate`, `/product-plan`, `/dev-plan`,
  `/implement`, `/qa`, `/update-docs`, and `/ship`.
- Incremental-change skills for shipped products: `/task` and `/evolve`.
- Adoption and maintenance skills: `/migrate-docs`, `/next-step`,
  `/improve-codebase-architecture`, and `/write-a-skill`.
- `/address-cves` skill for auditing and patching dependency CVEs across repos.
- Private `.harness/` documentation structure (product, engineering, adr, qa)
  that stays gitignored and is propagated across git worktrees.
- Distributed via the git marketplace; no npm publish step.
