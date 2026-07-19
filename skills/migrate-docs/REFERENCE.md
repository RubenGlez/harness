# Migrate Docs — Reference

## Harness File Templates

Migrate each file's content into the canonical template for its destination — do not keep a second copy of those templates here (they drift). The owning skills define them; transform the source into those exact sections, preserving ALL information (if something doesn't fit, add it under the closest section; never invent content for an empty one):

| Destination | Canonical template |
|---|---|
| `.harness/product/idea.md` | [`/ideate`](../ideate/SKILL.md) — "Write `.harness/product/idea.md`" |
| `.harness/product/{product,roadmap,competitors,ux,CONTEXT}.md` | [`/product-plan` REFERENCE](../product-plan/REFERENCE.md) — "Document Templates" |
| `.harness/engineering/{architecture,implementation-plan}.md`, `features/[slug].md`, `adr/NNNN-*.md`, root `DESIGN.md` | [`/dev-plan` REFERENCE](../dev-plan/REFERENCE.md) — "Document Templates" |
| `.harness/qa/report.md` | [`/qa` REFERENCE](../qa/REFERENCE.md) — "Report Template" |

### DESIGN.md: public tokens vs. migrated rationale

Use `.harness/product/ux.md` for internal design direction: workflow rationale, interaction model, design principles, creative north star, and UX decisions. If an existing `DESIGN.md` is mostly prose about how the product should feel or behave, migrate that content here.

Keep root `DESIGN.md` only for public design-token specifications: exact color, typography, spacing, radius, and component token values plus contributor-facing implementation rules. If a design file mixes token values with UX rationale, split it instead of preserving the mixed file.

---

## Adopting doctier on a repo with an existing (gitignored) `.harness/`

For projects that used harness before `.harness/` was git-tracked. The docs already exist on disk; the goal is to start tracking them encrypted without ever committing plaintext.

1. `rm -rf .harness/.base` — stale seed snapshot left by the old worktree hook, if present.
2. Run the doctier bootstrap in [../_shared/doctier-bootstrap.md](../_shared/doctier-bootstrap.md) (write the manifest, then `doctier init`, then `doctier grant`), including removing the legacy standalone `.harness/` line from `.gitignore`.
3. `doctier check` — must pass before tracking anything.
4. `git add .doctier.yml .doctier/ .gitattributes .gitignore .github/CODEOWNERS .harness/`
5. Verify encryption: `git show :.harness/<any-file> | head -1` must be an age/doctier envelope, not your prose. If it is plaintext, the filter is not active — stop, `git reset`, and re-run `doctier init` before trying again.
6. `doctier agents --write && git add AGENTS.md` — refresh the doc index so agents know which `.harness/` docs to read (creates the managed block, and the file itself if the repo has no `AGENTS.md`).
7. `git commit -m "chore: adopt doctier; track .harness/ encrypted"`
8. Old linked worktrees still carry seeded plaintext copies of `.harness/` — remove and recreate them so they use the tracked docs. (To refresh in place: run `doctier unlock` inside the worktree to re-decrypt the tracked docs over the stale copies.)
