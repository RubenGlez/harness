# Update Docs — Reference

## Subagent A: Internal docs

These files are for internal consumption. Write with full technical depth — include rationale, tradeoffs, and decisions. Do not soften for a public audience. Only update a file if the current-state summary affects it. Never link to `.harness/` from public docs.

**.harness/product/product.md** — update if the product's purpose, audience, positioning, or direction changed.

**.harness/product/roadmap.md** — update if features were completed (check them off), added, or reprioritized.

**.harness/product/competitors.md** — update only if the competitive landscape changed.

**.harness/product/ux.md** — update if user workflows or design direction changed.

**.harness/product/CONTEXT.md** — update if new domain terms were introduced or existing terms refined. Only add terms that are genuinely ambiguous or product-specific; remove terms that became self-evident.

**.harness/engineering/architecture.md** — update if the system structure, components, data flow, or stack changed.

**.harness/engineering/implementation-plan.md** — update completed tasks, add new ones, remove obsolete ones.

**.harness/adr/** — add a new ADR only if a significant architectural decision was made that isn't already recorded. Sequence continues from the highest existing number.

**.harness/engineering/features/[slug].md** — update Status if a feature moved to `done` or `blocked`. Update implementation notes if meaningful context was added. Do not change acceptance criteria retroactively.

**.harness/qa/report.md** — add a new report entry at the top if a new QA cycle was run; keep previous entries.

---

## Subagent B: Public docs

These files are visible on GitHub and to anyone who reads the repository. No links to `.harness/`, no internal strategy, no implementation details.

### README.md

Audience: GitHub visitors and potential users evaluating the project. The README is a public landing page, not a developer guide.

**Include:**
- What the product is and the problem it solves (one paragraph)
- Who it's for
- Key features (user-facing, not architectural)
- How to install and get started
- Basic usage examples

**Never include:**
- Internal architecture decisions or ADRs
- Implementation details (which library handles what)
- Agent-specific context or conventions
- Developer or contributor content: dev-environment setup, build-from-source steps, how to run tests, contribution guidelines, release process. If a setup fact is durable and an agent needs it, it belongs in `AGENTS.md`, not the README.
- Anything from `.harness/`

Keep it short. A README that requires scrolling to find the install command has failed.

### DESIGN.md *(only if UI design tokens changed)*

Uses the [DESIGN.md format](https://github.com/google-labs-code/design.md). YAML front matter holds exact token values; markdown prose explains rationale. Validate: `npx @google/design.md@0.2.0 lint DESIGN.md`

**Include:** color palette, typography, spacing, border-radius, key component tokens.

**Never include:** UX rationale from `.harness/product/ux.md`, competitive positioning, or references to `.harness/`.

### CHANGELOG.md *(only if new features or fixes were shipped)*

Follow [Keep a Changelog](https://keepachangelog.com) format. Add a new version entry at the top. List user-facing changes only — no internal refactors or doc-only changes.

### CLAUDE.md

Must contain exactly one line: `@AGENTS.md`. If it doesn't exist, create it. If it has content beyond `@AGENTS.md`, replace it.

### AGENTS.md

Include durable, agent-facing project facts that are not reliably inferable from the repo itself. Good candidates: human decisions, non-obvious constraints, external setup assumptions, workflow conventions, and project-specific exceptions to global rules.

**Never include:** commands from package.json, architecture descriptions, file structure, or links to `.harness/` files. AGENTS.md is a public committed file — referencing private paths produces broken references for anyone who clones the repo.

If nothing qualifies, leave AGENTS.md empty or with a single blank line. Keep it concise, but do not remove useful context just because the file is no longer nearly empty.

### Project sync standard

Verify: `CLAUDE.md` contains only `@AGENTS.md`, and `AGENTS.md` contains only genuinely undiscoverable, durable project facts (or nothing). If either file drifts, restore it.

---

## Promoting worktree docs to main

`.harness/` is gitignored, so it never travels through `git merge`. When you work in a parallel worktree, the SessionStart hook seeds `.harness/` from main and captures a pristine `.harness/.base/`. After Subagent A updates the worktree copy, this is how those changes (if wanted) reach main.

**Detect a worktree:**
```bash
[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ] && echo worktree
```
If it prints nothing you are in the main checkout — skip promotion entirely.

**Resolve the main checkout's `.harness/`:**
```bash
main_root=$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")
# main docs live at "$main_root/.harness"
```

**Reconcile (3-way), per file:** for each doc, you have three versions — `.harness/.base/<path>` (base: what main had at seed time), `.harness/<path>` (this worktree, now), and `$main_root/.harness/<path>` (main, now).
- Changed only in the worktree (main == base) → take the worktree version.
- Changed only in main (worktree == base) → keep main's; do nothing.
- Changed in both → merge by hand; for prose, integrate both intents rather than overwriting. Surface any genuine conflict to the user instead of guessing.
- New file in the worktree (absent from base and main) → add it.

Exclude `.harness/.base/` itself from reconciliation.

**Gate:** present the reconciled diff summary and ask before writing. If the user declines (e.g. a throwaway worktree), make no changes to `$main_root/.harness/`.

**Concurrency:** because each promotion reconciles against main *as it is right now*, running `/update-docs` in several worktrees one after another is safe — each later run sees the earlier run's changes. Two promotions executing at the exact same instant could still race; there is no locking, so avoid promoting from two worktrees simultaneously.
