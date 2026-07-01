---
name: migrate-docs
description: Discover all documentation in the repo, classify each file, transform content to match harness templates, and migrate everything to the correct location. Use on any existing project to adopt the harness workflow without starting from scratch.
---

# Migrate Docs

## Step 1: Discover

Scan the entire repo for documentation. Do not limit yourself to obvious locations — check everywhere.

**Root-level files**: `README.md`, `CHANGELOG.md`, `HISTORY.md`, `CONTRIBUTING.md`, `CONTRIBUTION.md`, `DESIGN.md`, `SPEC.md`, `PRD.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and any other `.md` files at the root.

**Common doc directories** — scan recursively: `docs/`, `documentation/`, `wiki/`, `spec/`, `specs/`, `notes/`, `planning/`, `design/`, `.github/`

**Package manifests** — check for usable product context: `package.json` (description, keywords), `pyproject.toml`, `go.mod`, `Cargo.toml`

**Existing harness structure** — read `.harness/` if present to avoid overwriting already-migrated content.

Build a complete inventory: path, one-line description, approximate size. Include everything — classify in the next step.

## Step 2: Classify

For each file, assign one classification:

**`keep-public`** — stays at repo root, no content changes: `README.md`, `CHANGELOG.md`/`HISTORY.md`, `LICENSE`, `CONTRIBUTING.md`/`CONTRIBUTION.md`, `DESIGN.md` when it is a public design-token specification, `SECURITY.md`, `CODE_OF_CONDUCT.md`

**`clean-public`** — stays at repo root but contains internal content to extract: a README mixing architecture decisions, competitive analysis, or internal strategy with public content.

**`migrate`** — move entirely to `.harness/`:

| Content type | Destination |
|---|---|
| Product vision, purpose, audience | `.harness/product/product.md` |
| Roadmap, backlog, feature lists | `.harness/product/roadmap.md` |
| Competitive analysis, market research | `.harness/product/competitors.md` |
| UX flows, interaction design | `.harness/product/ux.md` |
| Domain glossary, entity definitions | `.harness/product/CONTEXT.md` |
| Idea notes, viability research | `.harness/product/idea.md` |
| System architecture, tech stack | `.harness/engineering/architecture.md` |
| Implementation plans, task lists | `.harness/engineering/implementation-plan.md` |
| Per-feature specs | `.harness/engineering/features/[slug].md` |
| Architecture Decision Records | `.harness/adr/NNNN-[slug].md` |
| QA reports, test results | `.harness/qa/report.md` |

**`split`** — file covers more than one harness destination. List each destination and which portion maps there.

**`ignore`** — generated files, lock files, READMEs inside dependency folders.

### DESIGN.md special case

Do not assume every `DESIGN.md` should stay public. Classify by content:

- Public token/spec file — keep as `DESIGN.md`. It should contain concrete design tokens and contributor-facing implementation rules: colors, typography, spacing, radius, and component tokens.
- UX rationale, product design direction, design principles, interaction model, creative north star, or internal rationale — migrate to `.harness/product/ux.md`.
- Mixed token spec and UX rationale — split it: keep only the public token/spec material in `DESIGN.md`, and move the UX/design-rationale material to `.harness/product/ux.md`.

Never link public `DESIGN.md` to `.harness/`, and never keep internal design strategy public just because the filename is `DESIGN.md`.

## Step 3: Show the plan and confirm

Present a table:

```
| Current path            | Action        | Destination                              |
|-------------------------|---------------|------------------------------------------|
| docs/vision.md          | migrate       | .harness/product/product.md              |
| README.md               | clean-public  | README.md (extract strategy to .harness) |
| CHANGELOG.md            | keep-public   | CHANGELOG.md                             |
```

Also list: harness files with no source (will be created as stubs), and files being ignored and why.

Ask: "Does this migration plan look right? Anything to change before I proceed?"

Wait for explicit confirmation. Do not write any files until the user approves.

## Step 4: Migrate — spawn parallel subagents

### Doctier bootstrap (once per repo)

`.harness/` is tracked in git as age-encrypted blobs via doctier. If `.doctier.yml` exists at the repo root, skip this — the repo is already set up. If `.harness/` already exists but is gitignored (a pre-doctier project), follow the adoption recipe in [REFERENCE.md](REFERENCE.md) instead. Otherwise:

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

### Spawn the migration subagents

Spawn one subagent per destination harness file. Each writes a different destination file — two subagents must never edit the same `.harness/` file (encrypted docs cannot line-merge).

Each receives: full source content, destination path, the harness template (see [REFERENCE.md](REFERENCE.md)), and these instructions:

> Transform the source content into the harness template format. Preserve ALL information — do not discard or summarise away anything from the original. Restructure into template sections; if content doesn't fit, add it under the closest match. Do not invent content for empty sections. Write the result to the destination path.

## Step 5: Handle clean-public files

For `clean-public` files: extract internal content to the appropriate `.harness/` file (via the relevant subagent), then edit the public file to remove the extracted sections. Ensure what remains reads cleanly. Never leave a dangling reference.

## Step 6: Confirm deletion

List every original that was fully migrated. Ask: "All content has been written to its harness location. Delete the originals?"

Wait for confirmation. If confirmed: delete each original and remove empty directories.

**Never delete an original if there is any doubt that its content was fully captured.**

## Step 7: Fix broken references

Scan every public doc for references to paths that no longer exist. For each: if content moved to `.harness/`, remove the reference entirely (never replace with a `.harness/` link); if merged into a public doc, update the reference. Do not leave this step until `grep -r "docs/" *.md` returns no matches in public docs.

## Step 8: Commit and report

Refresh the doc index and commit the migration in one commit — the migrated `.harness/` docs together with the cleaned public files (worktrees and future sessions only see committed `.harness/` content):

```bash
doctier agents --write
git add -A && git commit -m "docs: migrate documentation to harness layout"
```

```
## Migration complete

### Written to .harness/
- [path] — migrated from [source] / created as stub

### Public docs (kept or cleaned)
- [path] — kept unchanged / internal content extracted

### Originals deleted
- [path]

### Stubs created
- [path] — populate with /[skill-name]

### Suggested next step
```

Suggest based on state: product docs only → `/dev-plan`; thin product docs → `/product-plan`; feature specs present → `/implement` or `/qa`; all docs present → `/update-docs`.
