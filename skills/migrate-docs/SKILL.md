---
name: migrate-docs
description: Discover all documentation in the repo, classify each file, transform content to match harness templates, and migrate everything to the correct location. Also adopts doctier encrypted tracking for .harness/ on pre-doctier harness projects. Use on any existing project to adopt the harness workflow without starting from scratch.
---

# Migrate Docs

**Precondition: a clean working tree.** The migration ends in a commit of everything it changed; unrelated uncommitted changes would be swept into that commit. If `git status --porcelain` is not empty, stop and ask the user to commit or stash first.

## Step 0: Adopt doctier (pre-doctier harness repos)

Before discovering anything, check whether this repo already uses harness but predates doctier — `.harness/` exists but isn't tracked in git:

```bash
[ -d .harness ] && { [ ! -f .doctier.yml ] || [ -z "$(git ls-files .harness)" ]; } && echo pre-doctier
```

If it prints `pre-doctier`, the docs are already in their harness locations — the migration needed is the storage change, not a doc move. Follow the adoption recipe in [REFERENCE.md](REFERENCE.md) ("Adopting doctier on a repo with an existing (gitignored) `.harness/`"): it runs the doctier bootstrap (Step 4 below), removes the legacy gitignore line, and commits the docs encrypted.

After the adoption, continue with Step 1 only if the repo also has scattered docs outside `.harness/` to migrate. If not, report the adoption — files now tracked (`git ls-files .harness`), ciphertext verified (`git show :.harness/<file> | head -1`), commit hash — and stop; the migration is complete.

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

### Path-referenced docs

Before classifying a file as `migrate`, check whether anything reads it by path: skills, scripts, validators, CI, or links from a public doc (`grep -r "<filename>" --include='*.md' --include='*.yml' -l`, plus the obvious code extensions). A doc that tooling consumes or a public README links to is a functional input — classify it `keep-public` no matter how internal its content looks, and note why in the plan. Moving it breaks the tool or leaves a dangling link, and Step 7 cannot fix a reference that lives inside a skill or script.

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

Also list: harness files with no source content — these will **not** be created (note which skill produces each properly, e.g. `/product-plan` for product docs, `/dev-plan` for engineering docs) — and files being ignored and why. Never invent content: a harness file only exists if real source material migrated into it.

Ask: "Does this migration plan look right? Anything to change before I proceed?"

Wait for explicit confirmation. Do not write any files until the user approves.

## Step 4: Migrate — spawn parallel subagents

### Doctier bootstrap (once per repo)

`.harness/` is tracked in git as age-encrypted blobs via doctier. If `.doctier.yml` exists at the repo root, skip this — the repo is already set up (a pre-doctier `.harness/` was already handled in Step 0). Otherwise:

1. Check the binary: `command -v doctier`. If missing, STOP and tell the user: "harness doc skills require doctier. Install it with `brew tap RubenGlez/doctier https://github.com/RubenGlez/doctier && brew install doctier`, or without Homebrew: `curl -fsSL https://raw.githubusercontent.com/RubenGlez/doctier/main/install.sh | sh`. Then re-run this skill." Do not write `.harness/` docs without it.
2. Write `.doctier.yml` at the repo root (if the rules change later, re-run `doctier init` — it syncs the managed `.gitattributes`/`.gitignore` blocks):

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

3. Run `doctier init` (configures the git filter and decrypted-diff textconv, writes the managed attribute/ignore blocks, installs pre-commit, pre-push, and post-merge hooks).
4. Run `doctier grant "$(cat "${DOCTIER_SSH_KEY:-$HOME/.ssh/id_ed25519}.pub")"`.
5. If `.gitignore` has a legacy standalone `.harness/` line, delete that line.
6. Protect the policy files: `.doctier.yml`, `.doctier/recipients.txt`, and `.gitattributes` are tracked, unauthenticated files — anyone with commit access can reclassify a private path as public or add their own key. Add CODEOWNERS entries for those three paths assigning the repo owner (create `.github/CODEOWNERS` if absent), and treat any diff to them as a security review.
7. Verify with `doctier check`, then commit the scaffolding: `git add .doctier.yml .doctier/ .gitattributes .gitignore .github/CODEOWNERS && git commit -m "chore: adopt doctier for .harness/ docs"`.

### Spawn the migration subagents

Spawn one subagent per destination harness file **that has source content** — destinations with nothing to migrate are not created (see Step 3). Each writes a different destination file — two subagents must never edit the same `.harness/` file (encrypted docs cannot line-merge).

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
- [path] — migrated from [source]

### Public docs (kept or cleaned)
- [path] — kept unchanged / internal content extracted

### Originals deleted
- [path]

### Not created (no source content)
- [path] — produce it with /[skill-name] when needed

### Suggested next step
```

Suggest based on state: product docs only → `/dev-plan`; thin or missing product docs → `/product-plan`; feature specs present → `/implement` or `/qa`; all docs present → `/update-docs`.

## Fleet mode

When asked to migrate many repos (or "all my repos"), run the sweep as a structured batch instead of improvising per repo:

1. **Enumerate** — `gh repo list --limit 200 --json name,isPrivate,isArchived,url`. Drop archived repos, apply the visibility filter the user asked for, and add any repos they named explicitly.
2. **Ask the scope questions once**, up front, for the whole fleet: adoption-only vs full doc migration, commit-only vs push, and which edge-case repos to include or skip. Do not re-ask per repo.
3. **Locate or clone** each repo locally. `git pull --ff-only` any that are behind; a repo with a dirty working tree pauses that repo (see the precondition), not the fleet.
4. **Classify each repo by state**:
   - `.harness/` exists but untracked → Step 0 adoption. No per-repo plan confirmation needed — adoption moves storage, not content.
   - No `.harness/`, docs scattered or absent → full Steps 1–8; the Step 3 plan confirmation still applies per repo (batch the plans into one message where practical).
   - Already on doctier → skip, report as such.
5. **Prove the flow on one repo first** (adopt, commit, push, verify remote ciphertext), then batch the rest with the same recipe. Verify every repo independently: encryption gate on staged blobs, `doctier check`, and remote ciphertext after push — never assume a repeat run worked because the first one did.
6. **Report one summary table**: repo, action taken, encrypted-file count, sync state, and anything skipped with the reason.
