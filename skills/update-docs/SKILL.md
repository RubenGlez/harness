---
name: update-docs
description: Update all project documentation to reflect the current state of the codebase. Refreshes docs/product/, docs/engineering/, docs/adr/, docs/design.md, README.md, CLAUDE.md, and AGENTS.md. Use after finishing a feature, refactor, or any meaningful change — or whenever docs feel stale.
---

# Update Docs

## Step 1: Build a current-state summary

Before writing anything, read everything. The goal is a complete picture of what the project is now and what changed since the docs were last accurate.

**Git history** — understand what changed:
- `git log --oneline -20` to see recent commits
- `git diff` against the last meaningful commit if useful
- Note which areas of the codebase were touched

**Existing docs** — understand the current documented state:
- Read all files under `docs/` (product/, engineering/, adr/, design.md)
- Read `README.md`
- Read `CLAUDE.md` and `AGENTS.md` if they exist

**Codebase** — understand the current actual state:
- Read README and CLAUDE.md for any existing structure notes
- Scan key directories: routes, screens, commands, API endpoints, config files
- Check package.json / pyproject.toml / go.mod or equivalent for dependencies and scripts
- Note what's implemented, what's been removed, and what's changed shape

Synthesize a **current-state summary** covering:
- What the product does now (not what was planned)
- What the architecture looks like now
- What changed recently that docs don't yet reflect
- Which doc files are stale, which are accurate, which are missing entirely

Do not write any files yet.

## Step 2: Spawn two subagents in parallel

Pass the full current-state summary to each subagent — they cannot read the conversation or the codebase themselves.

---

**Subagent A** updates internal docs under `docs/`.

These files are for internal consumption: team members, AI agents doing implementation work, and future decision-makers. Write with full technical depth. Include rationale, tradeoffs, and decisions. Do not soften or simplify for a public audience.

Only update a file if something in the current-state summary affects it. Do not touch files that are still accurate. Do not invent content for sections not covered by the summary.

**docs/product/product.md** — update if the product's purpose, audience, positioning, or direction changed.

**docs/product/roadmap.md** — update if features were completed (check them off), added, or reprioritized.

**docs/product/competitors.md** — update only if the competitive landscape changed.

**docs/product/ux.md** — update if user workflows or design direction changed.

**docs/engineering/architecture.md** — update if the system structure, components, data flow, or stack changed.

**docs/engineering/implementation-plan.md** — update completed tasks, add new ones, remove obsolete ones.

**docs/design.md** — update if visual design tokens (colors, typography, spacing, components) changed. Validate after writing: `npx @google/design.md lint docs/design.md`

**docs/adr/** — add a new ADR only if a significant architectural decision was made that isn't already recorded. Do not retrofit ADRs for decisions that are obvious from the code. Sequence continues from the highest existing number.

---

**Subagent B** updates public and AI-facing files.

These files have different audiences and require a different register. Keep them strictly separated.

### README.md — public face

Audience: GitHub visitors, potential users, open source contributors. They know nothing about the project internals.

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
- Anything from docs/engineering/ or docs/adr/
- The contents of CLAUDE.md

Keep it short. A README that requires scrolling to find the install command has failed.

### CLAUDE.md — AI agent context for Claude Code

Audience: Claude Code agents working in this codebase. They need to navigate efficiently without reading every file.

**Include:**
- What this repo is (one paragraph, technical)
- How to install, run, build, and test
- Key file and directory layout — where things live
- Conventions: naming, structure, patterns the codebase follows
- Non-obvious constraints or gotchas
- Which files are auto-generated or should not be edited

**Never include:**
- Product strategy or market positioning (that's docs/product/)
- Competitive analysis
- User-facing feature descriptions
- Content that duplicates README.md

### AGENTS.md — AI agent context for other agents (Codex, etc.)

Same content and rules as CLAUDE.md. If both files exist, keep them in sync. If only one exists, create the other with identical content.

---

## Step 3: Confirm

After both subagents finish, report:
- Every file updated, with one line on what changed
- Every file left untouched and why
- Any doc gaps noticed that this run couldn't fill (e.g. a decision that should be an ADR but lacks enough context)
