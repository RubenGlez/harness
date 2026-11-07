# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Engineering principles: eight short rules (prove it works, fix root causes,
  attack the premise, subtract before you add, model the domain, sequence
  verifiable units, encode lessons in structure, guard the context window),
  indexed in the global rules with full text in `skills/_shared/principles/`.
- `/interrogate`: adversarial review where parallel adversaries try to break a
  change and only findings proven by a run survive. `/qa` runs it for risky
  features.
- `/review-diff`: two-axis review of a diff. Standards (repo conventions plus a
  Fowler smell baseline) and Spec (against `.harness/engineering/features.md`)
  run as separate subagents and are reported side by side. `/implement` runs
  it after the integration check; Spec gaps mark a feature `blocked`.

### Changed
- `/task` now also handles refactors and perf fixes, and routes bugs, refactors
  and perf fixes through step-by-step playbooks copied into the task list.
- `/task` bug-fix playbook: a fix now starts from a tight, red-capable feedback
  loop, then minimises the repro, ranks falsifiable hypotheses, tags debug logs
  for one-grep cleanup, and records a missing test seam as a finding.
- `/write-a-skill`: choose model- vs user-invoked first (with
  `disable-model-invocation` and a matching description style), end every step
  on a checkable completion criterion, decide what to split out by which runs
  need it, and check the name against built-in commands.
- Global rules: PR bodies follow a Summary (smallest visual), Evidence
  (before/after) and Merge danger (one- or two-way door, blast radius) shape.

## [0.3.2] - 2026-07-19

### Changed
- Global rules now defer to a skill's own verification contract when it defines
  one (e.g. `/implement` runs static checks only and leaves behavioral testing
  to `/qa`), resolving the contradiction with the default "test where it runs"
  rule that every subagent was carrying.
- `/next-step` can now recommend `/improve-codebase-architecture` for a stable
  codebase with architectural friction.
- `/write-a-skill`: reframed the SKILL.md size guidance around moving detail to
  REFERENCE.md, and clarified how a new skill becomes available — `/reload-skills`
  in Claude Code, `bash update.sh` for Codex.

### Fixed
- `statusline.sh` git-detection precedence: the `.git` and `rev-parse` checks are
  now grouped so an empty working dir can't fall through to `git -C ""`.

## [0.3.1] - 2026-07-19

### Fixed
- Codex now actually receives the shared global rules. They were injected into
  `~/.agents/AGENTS.md`, but Codex reads global instructions from
  `~/.codex/AGENTS.md` — so none of the harness guidelines reached Codex.
  `rules-config.py` now targets `$CODEX_HOME/AGENTS.md` and prepends the managed
  block, preserving any existing imports (e.g. a user's `@RTK.md`) instead of
  overwriting the file.

### Changed
- The subagent-spawning skills (`/implement`, `/update-docs`, `/dev-plan`,
  `/product-plan`, `/migrate-docs`, `/improve-codebase-architecture`) now
  reference `skills/_shared/runtime-parallelism.md`, which defines a sequential
  fallback for runtimes without Claude's Agent tool and worktrees (e.g. Codex),
  so the skills degrade to correct sequential behavior instead of assuming a
  Claude-only mechanism.

## [0.3.0] - 2026-07-19

### Changed
- The installer is now pure bash + python3: `bash setup.sh` installs everything.
  The interactive Node/inquirer wizard and its custom-component mode were removed
  (custom choices never survived `update.sh`), so Node and npm are no longer
  prerequisites.
- The doctier bootstrap and the migration doc templates now live in one place
  each (`skills/_shared/doctier-bootstrap.md` and the owning skills' REFERENCE
  files); `/ideate`, `/product-plan`, and `/migrate-docs` reference them instead
  of carrying their own copies.

### Removed
- The four bundled subagents (`agents/`) — advertised in the README but never
  invoked by any skill.

### Fixed
- `/dev-plan` and `/update-docs` doc commits no longer stage nothing when an
  optional file (`DESIGN.md`, `CHANGELOG.md`) is absent — `git add` was aborting
  atomically on the missing pathspec, so the whole commit could come up empty.
- `/implement` cleanup no longer tells the agent to `git branch -D` an aborted
  or `blocked` feature's branch: that branch is now kept (deleting it needs
  `-D`, which the block-dangerous-git hook stops, and would strand the work).
- Session status line: the outstanding-issue count now reads the QA report
  summary instead of a checkbox pattern the report never used, and the
  always-"Phase 1" heading was removed.
- The setup wizard no longer offers a `handoff-nudge` hook that was never
  implemented; a smoke test now guards wizard/hook parity.

## [0.2.0] - 2026-07-02

### Added
- Acceptance criteria are written as Given/When/Then checkbox one-liners: the
  feature templates in `/dev-plan` and `/migrate-docs` prescribe the format,
  `/qa` maps it to setup/action/assertion when testing, and `/task` preserves
  the phrasing when syncing specs.
- `/migrate-docs` fleet mode: migrate many repos in one structured sweep —
  enumerate via `gh`, ask scope questions once, prove the flow on one repo,
  batch the rest, verify each independently, one summary report.
- `/migrate-docs` classification guards against moving path-referenced docs:
  files that skills, scripts, CI, or public READMEs consume by path stay
  public regardless of content.

### Fixed
- The `/migrate-docs` doctier adoption recipe now refreshes the AGENTS.md doc
  index (`doctier agents --write`); adopted repos were previously left without
  the project-context block that tells agents which `.harness/` docs to read.
- `/migrate-docs` now requires a clean working tree up front, so the final
  migration commit cannot sweep in unrelated uncommitted changes.

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
