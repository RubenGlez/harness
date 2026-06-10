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

Audience: GitHub visitors, potential users, open source contributors.

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

Keep it short. A README that requires scrolling to find the install command has failed.

### DESIGN.md *(only if UI design tokens changed)*

Uses the [DESIGN.md format](https://github.com/google-labs-code/design.md). YAML front matter holds exact token values; markdown prose explains rationale. Validate: `npx @google/design.md@0.2.0 lint DESIGN.md`

**Include:** color palette, typography, spacing, border-radius, key component tokens.

**Never include:** UX rationale from `.harness/product/ux.md`, competitive positioning, or references to `.harness/`.

### CHANGELOG.md *(only if new features or fixes were shipped)*

Follow [Keep a Changelog](https://keepachangelog.com) format. Add a new version entry at the top. List user-facing changes only — no internal refactors or doc-only changes.

### CONTRIBUTION.md *(only if open source and guidelines changed)*

**Include:**
- How to set up the development environment
- How to run tests
- Coding conventions and pull request requirements

**Never include:** internal architecture or anything from `.harness/`. Keep to one page. Skip if not open source.

### CLAUDE.md

Must contain exactly one line: `@AGENTS.md`. If it doesn't exist, create it. If it has content beyond `@AGENTS.md`, replace it.

### AGENTS.md

**Nearly empty by default.** Only include facts that are both undiscoverable from the codebase AND globally relevant on every session.

**Never include:** commands from package.json, architecture descriptions, file structure, or links to `.harness/` files. AGENTS.md is a public committed file — referencing private paths produces broken references for anyone who clones the repo.

If nothing qualifies, leave AGENTS.md empty or with a single blank line. An empty AGENTS.md is correct. A bloated one is harmful.

### Project sync standard

Verify: `CLAUDE.md` contains only `@AGENTS.md`, and `AGENTS.md` contains only genuinely undiscoverable global facts (or nothing). If either file drifts, restore it.
