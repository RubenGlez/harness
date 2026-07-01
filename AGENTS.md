# Harness

This repo intentionally uses npm (not pnpm, despite the global rule): `setup.sh` is an installer that must run on a fresh machine where only Node and its bundled npm exist.

`.harness/` (product/engineering/adr/qa docs) is tracked in git as age-encrypted blobs via doctier (`.doctier.yml` holds the rules; `doctier check` is wired as a pre-commit hook). Linked worktrees check out decrypted docs automatically — the filter lives in the main clone's `.git/config` — so anything a worktree must see has to be **committed** first. Fresh clones must run `doctier init` once (filter config and hooks don't travel through git), then force a re-smudge with `rm -rf .harness && git checkout -- .harness` (a plain checkout no-ops because the index already matches); until then `.harness/` files are ciphertext.

**Never let two parallel agents edit the same `.harness/` file.** Encrypted blobs cannot line-merge — a two-sided edit is an unresolvable binary conflict. `/implement` subagents therefore read `.harness/` but never write it; the orchestrator is the sole writer and commits doc changes before spawning worktrees and after merging.

**Treat any diff to `.doctier.yml`, `.doctier/recipients.txt`, or `.gitattributes` as a security review.** They are tracked, unauthenticated policy: a change can reclassify a private path as public or add a new decryption key. `.github/CODEOWNERS` gates them; do not edit them except through the documented bootstrap/grant flows.

## Verification contract

`/implement` slices are verified by static checks only (typecheck, build, lint). Behavioral verification and cross-feature integration testing are deferred to `/qa` by design — this keeps parallel slices fast and collision-free (no competing servers, ports, or fixtures across worktrees). The consequence is intentional: a feature marked `done` by `/implement` has compiled but not necessarily executed; `/qa` is the first time acceptance criteria are exercised. Do not add behavioral verification to subagent prompts.

## Release

This is a Claude Code plugin distributed via the git marketplace (no npm publish; `package.json` is `private`). To release: bump `version` in `.claude-plugin/plugin.json`, commit, create an annotated `vX.Y.Z` tag, and push branch + tag. The tag is the release marker — there is no external deploy step.

<!-- doctier:begin -->
## Project context

Managed by doctier — do not edit between the markers.

Read these for project context:

- `.harness/engineering/architecture.md`
- `.harness/product/roadmap.md`
- `.harness/qa/docs-compliance-report.md`
- `.harness/qa/report.md`
<!-- doctier:end -->
