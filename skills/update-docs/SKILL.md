---
name: update-docs
description: Update all project documentation to reflect the current state of the codebase. Refreshes .harness/product/, .harness/engineering/, .harness/adr/, and public root docs (README.md, DESIGN.md, CHANGELOG.md). Use after finishing a feature, refactor, or any meaningful change — or whenever docs feel stale.
---

# Update Docs

## Step 1: Build a current-state summary

Before writing anything, read everything. The goal is a complete picture of what the project is now and what changed since the docs were last accurate.

**Git history** — understand what changed:
- `git log --oneline -20` to see recent commits
- `git diff` against the last meaningful commit if useful
- Note which areas of the codebase were touched

**Existing docs** — understand the current documented state:
- Read all files under `.harness/` (product/, engineering/, adr/, qa/)
- Read `README.md`, `DESIGN.md`, `CHANGELOG.md`, `CONTRIBUTION.md` if they exist in the root

**Codebase** — understand the current actual state:
- Read README.md and CLAUDE.md for any existing structure notes
- Scan key directories: routes, screens, commands, API endpoints, config files
- Check package.json / pyproject.toml / go.mod or equivalent for dependencies and scripts
- Note what's implemented, what's been removed, and what's changed shape

Synthesize a **current-state summary** using this structure — subagents receive it verbatim and need it to be precise:

```
## What the product is now
[One paragraph: what it does, who it's for, current state of implementation]

## Recent changes not yet in docs
- [change] — [which docs this affects]

## Stale docs
- [file path] — [what's outdated and why]

## Accurate docs (do not touch)
- [file path] — [why it's still current]

## Missing docs
- [file path that should exist but doesn't, and why it's needed]
```

Do not write any files yet.

### Gitignore check

Before writing any file, check whether `.harness/` is covered by `.gitignore`. If not, add it:
```
echo '.harness/' >> .gitignore
```
Only add it if the entry isn't already present.

## Step 2: Spawn two subagents in parallel

Pass the full current-state summary to each subagent — they cannot read the conversation or the codebase themselves.

---

**Subagent A** updates internal docs under `.harness/`.

These files are for internal consumption: team members, AI agents doing implementation work, and future decision-makers. Write with full technical depth. Include rationale, tradeoffs, and decisions. Do not soften or simplify for a public audience.

Only update a file if something in the current-state summary affects it. Do not touch files that are still accurate. Do not invent content for sections not covered by the summary.

**Never link to `.harness/` files from any public document.**

**.harness/product/product.md** — update if the product's purpose, audience, positioning, or direction changed.

**.harness/product/roadmap.md** — update if features were completed (check them off), added, or reprioritized.

**.harness/product/competitors.md** — update only if the competitive landscape changed.

**.harness/product/ux.md** — update if user workflows or design direction changed.

**.harness/product/CONTEXT.md** — update if new domain terms were introduced or existing terms refined during implementation or QA. Only add terms that are genuinely ambiguous or product-specific; remove terms that became self-evident from context.

**.harness/engineering/architecture.md** — update if the system structure, components, data flow, or stack changed.

**.harness/engineering/implementation-plan.md** — update completed tasks, add new ones, remove obsolete ones.

**.harness/adr/** — add a new ADR only if a significant architectural decision was made that isn't already recorded. Do not retrofit ADRs for decisions that are obvious from the code. Sequence continues from the highest existing number.

**.harness/engineering/features/[slug].md** — update Status if a feature moved to `done` or `blocked`. Update implementation notes if meaningful context was added during the session. Do not change acceptance criteria retroactively.

**.harness/qa/report.md** — update if a new QA cycle was run: add a new report entry at the top, keep previous entries.

---

**Subagent B** updates public docs in the repo root.

These files are visible on GitHub and to anyone who reads the repository. Keep them strictly separated from internal content — no links to `.harness/`, no internal strategy, no implementation details.

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
- Anything from `.harness/`
- Links to `.harness/` files

Keep it short. A README that requires scrolling to find the install command has failed.

### DESIGN.md — public design system *(only if UI design tokens changed)*

Uses the [DESIGN.md format](https://github.com/google-labs-code/design.md). YAML front matter holds exact token values; markdown prose explains the rationale. Validate after writing: `npx @google/design.md lint DESIGN.md`

**Include:** color palette, typography, spacing, border-radius, key component tokens.

**Never include:** internal UX rationale from `.harness/product/ux.md`, competitive positioning, or references to `.harness/`.

### CHANGELOG.md *(only if new features or fixes were shipped)*

Follow [Keep a Changelog](https://keepachangelog.com) format. Add a new version entry at the top. List user-facing changes only — no internal refactors or doc-only changes unless they affect users.

### CONTRIBUTION.md *(only if the project is open source and it doesn't exist yet, or contribution guidelines changed)*

Audience: external contributors who want to submit pull requests.

**Include:**
- How to set up the development environment
- How to run tests
- Coding conventions and pull request requirements

**Never include:**
- Internal architecture details or rationale
- Anything from `.harness/`

Keep it to one page. If the project is not open source, skip it.

### CLAUDE.md — AI agent context for Claude Code *(only if repo structure or conventions changed)*

Audience: Claude Code agents working in this codebase. They need to navigate efficiently without reading every file.

**Include:**
- What this repo is (one paragraph, technical)
- How to install, run, build, and test
- Key file and directory layout — where things live
- Conventions: naming, structure, patterns the codebase follows
- Non-obvious constraints or gotchas
- Which files are auto-generated or should not be edited

**Never include:**
- Product strategy or market positioning (that's `.harness/product/`)
- Competitive analysis
- User-facing feature descriptions
- Content that duplicates README.md
- Links to `.harness/` files

### AGENTS.md *(only if CLAUDE.md was updated)*

Same content and rules as CLAUDE.md. If both files exist, keep them in sync. If only one exists, create the other with identical content.

---

## Step 3: Confirm

After both subagents finish, report:
- Every file updated, with one line on what changed
- Every file left untouched and why
- Any doc gaps noticed that this run couldn't fill (e.g. a decision that should be an ADR but lacks enough context)

If all QA criteria are passing and docs are current, the project cycle is complete for this phase. Recommend next step based on the roadmap state: start the next phase with /implement, or close the current milestone.
