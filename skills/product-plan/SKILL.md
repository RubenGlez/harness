---
name: product-plan
description: Define the full product vision — audience, positioning, features, roadmap, and UX direction — through a structured interview. Use after ideate, or directly when the idea is already validated and you're ready to spec the product.
---

# Product Plan

## Step 1: Read the project

Before asking anything, gather all available context:

**Ideation output** — read `.harness/product/idea.md` if it exists:
- Extract: concept, problem, market landscape, competitor list, viability verdict
- These questions are already answered — do not re-ask them in the interview

**Existing product docs** — read `.harness/product/` for prior decisions to update rather than re-litigate

**Codebase** — if code already exists:
- Read README.md for stated goals and audience
- Scan the feature surface: routes, screens, commands, or API endpoints
- Check the roadmap or issue tracker if present (`gh issue list`)
- Note what's implemented, what's stubbed, and what's conspicuously absent

**Starting mid-flow on an existing project**: if code exists but `.harness/` is absent, treat this as step 2 — `/ideate` was skipped. Read the codebase and README to reconstruct what `idea.md` would have said, then proceed.

Synthesize into a one-paragraph internal picture. Do not share this — use it to skip already-answered questions and form sharper hypotheses.

## Step 2: Interview

Interview the user relentlessly — one question at a time. For every question, state a concrete recommendation or hypothesis first. Never ask a bare question. Lead with your position — "My read is X. Do you agree?" — so the user reacts to a specific claim.

**Be a realist, not a cheerleader.** Surface the truth, not validation: name failure modes, push back on optimistic answers, make vague audiences concrete, call out weak moats.

Work through these dimensions in order; skip any already answered. See [REFERENCE.md](REFERENCE.md) for detailed questions per dimension:

1. The idea
2. Target audience
3. Market and competition *(skip if idea.md covers it)*
4. Value and differentiation
5. Validation
6. Features
7. UX and design

## Step 3: Report

After the interview, produce a report with these sections:
- **Audience** — who it's for, who the early adopter is, why they care
- **Value Proposition** — for whom, the key benefit, the core differentiator, why users switch (synthesize from dimensions 4 and 5)
- **Market Positioning** — category, differentiation, competitive gap
- **Competitive Analysis** — top 3–5 competitors, strengths, weaknesses
- **Direction Assessment** — go / conditional go / no-go with 2–3 reasons
- **Prioritized Feature Backlog** — must-have / should-have / nice-to-have
- **UX and Design Direction** — core workflow, interaction model, design register
- **Key Risks** — 2–3 assumptions most likely to be wrong and how to test them

## Step 4: Write docs

### Doctier bootstrap (once per repo)

`.harness/` is tracked in git as age-encrypted blobs via doctier. If `.doctier.yml` exists at the repo root, skip this — the repo is already set up. If `.harness/` already exists but is gitignored (a pre-doctier project), follow the adoption recipe in the migrate-docs skill's REFERENCE.md instead. Otherwise:

1. Check the binary: `command -v doctier`. If missing, STOP and tell the user: "harness doc skills require doctier. Install it with `go install github.com/rubenglez/doctier@latest` (needs Go), then re-run this skill." Do not write `.harness/` docs without it.
2. Write `.doctier.yml` at the repo root. Write it BEFORE running init — `doctier init` derives `.gitattributes` and `.gitignore` entries from the manifest and never reconciles them later:

   ```yaml
   version: 1

   # .harness/ is the private doc store: encrypted in git, decrypted on checkout.
   # Prototype/spike code is sensitive scratch: never committed, dies with the worktree.
   docs:
     - path: ".harness/**"
       visibility: private
       lifetime: durable

     - path: "**/_prototype-*"
       visibility: private
       lifetime: ephemeral
       sensitive: true

     - path: "**/_spike/**"
       visibility: private
       lifetime: ephemeral
       sensitive: true

   recipients_file: .doctier/recipients.txt
   ```

3. Run `doctier init` (configures the git filter, appends the attribute/ignore blocks, installs pre-commit and post-merge hooks).
4. Run `doctier grant "$(cat "${DOCTIER_SSH_KEY:-$HOME/.ssh/id_ed25519}.pub")"`.
5. If `.gitignore` has a legacy standalone `.harness/` line, delete that line.
6. Verify with `doctier check`, then commit the scaffolding: `git add .doctier.yml .doctier/ .gitattributes .gitignore && git commit -m "chore: adopt doctier for .harness/ docs"`.

### Spawn the doc writer

Spawn a subagent to write all product docs. Pass the full report as context — it cannot read the conversation.

Rules: all files go under `.harness/product/`; update existing rather than overwrite; omit sections with no source; never link to `.harness/` from public docs.

The subagent writes: `product.md`, `roadmap.md`, `competitors.md`, `ux.md` (if UI discussed), and `CONTEXT.md` (domain glossary). See [REFERENCE.md](REFERENCE.md) for templates.

After the subagent finishes, confirm every file written. Refresh the doc index and commit — worktrees and future sessions only see committed `.harness/` content:

```bash
doctier agents --write
git add .harness AGENTS.md && git commit -m "docs: product plan"
```

Recommend: "Run /dev-plan to define the architecture and generate feature specs."
