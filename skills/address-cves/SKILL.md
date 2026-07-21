---
name: address-cves
description: Find and fix high and critical application dependency CVEs across all non-archived GitHub repositories available to the authenticated gh CLI user. Use when the user asks to address, remediate, audit, patch, or report severe CVEs/security advisories across many repos, including cloning missing repos, scanning dependencies and GitHub Actions, making dependency changes, testing, committing, pushing, merging to main after validation, cleaning branches, and producing a Markdown stdout report.
---

# Address CVEs

Remediate high and critical application dependency vulnerabilities across repositories discovered with `gh`. Work repo-by-repo, preserve user changes, validate before merging, and report exactly what happened.

Read [REFERENCE.md](REFERENCE.md) when choosing scanners, upgrade strategies, or validation commands for a specific ecosystem.

## Operating Contract

- Discover repos with `gh`; include private repos; exclude archived repos.
- Clone missing repos into `~/workspace`.
- Skip dirty local repos and report them.
- Address only high and critical vulnerabilities. Low and moderate findings are noise: never fix them, never let them fail validation, never let them pad the report.
- Include runtime and dev dependencies; label dev-only findings when detectable.

Severity and dependency scope are independent filters, and they move in opposite directions. Keep them straight:

| Axis | Rule | Flag |
|---|---|---|
| Severity | Narrow. High/critical only. | `--audit-level=high` — always |
| Dependency scope | Wide. Runtime *and* dev. | `--prod` / `--omit=dev` — never |

Narrowing the severity filter is the point of this skill. Narrowing the dependency scope hides real findings: a prod-filtered scan reports clean while high-severity dev findings remain.
- Include GitHub Actions/workflow dependency issues.
- Exclude Docker base image and OS package CVEs.
- Prefer temporary scanner runners (`npx`, `uvx`, `pipx run`, `go run`, etc.) over installing scanner tools into projects.
- Prefer the smallest safe upgrade.
- Attempt breaking migrations when required to fix a high/critical issue.
- Prefer direct dependency upgrades; use low-risk overrides/resolutions for transitive issues when needed and report them as maintenance debt.
- Replace abandoned packages when that is the practical fix.
- Create, commit, push, validate, merge to `main`, push `main`, then delete local and remote security branches only when validation passes.
- If validation fails after changes, clean up the security branch and report the failed attempt.
- Produce the final report as Markdown on stdout only.

## Step 1: Discover Repositories

Confirm `gh auth status` works. If not, stop and ask the user to authenticate.

Check the token scopes in that output. Listing Dependabot alerts needs `admin:repo_hook`; without it those calls fail with a permissions error mid-run. If it is missing, tell the user to run `gh auth refresh -h github.com -s admin:repo_hook` themselves — it is an interactive device flow that will hang if you run it in the background — then continue with ecosystem scanners and note the gap.

Build the repo set from the authenticated account and its orgs:

1. Get the viewer login with `gh api user --jq .login`.
2. List non-archived repos for the viewer with `gh repo list <login> --limit 1000 --json nameWithOwner,isArchived,isPrivate,url,defaultBranchRef`.
3. List orgs with `gh org list --limit 1000`; for each org, list repos with the same `gh repo list` fields.
4. Deduplicate by `nameWithOwner`.
5. Keep only `isArchived == false`.

For each repo, ensure it exists under `~/workspace/<repo-name>` unless a matching clone already exists. Prefer `~/workspace/<owner>/<repo>` if multiple owners have the same repo name.

## Step 2: Preflight Each Repo

For each repo:

1. Fetch default branch and remotes.
2. If the worktree is dirty, skip it and add it to the report.
3. Checkout and update the default branch, expected to be `main` unless the repo metadata says otherwise.
4. Create or reset a local branch named `security/fix-high-critical-cves` from the updated default branch.

Do not overwrite user work. If the branch already exists and contains unmerged local work, inspect the commits before deciding:

- **Leftovers from a previous run of this skill** — recognisable by the `fix: address high and critical CVEs` subject and a `Claude-Session` trailer from an earlier session. These are not user work. Their lockfiles are stale and predate current advisories, so rebuilding from the updated default branch beats salvaging them. Ask the user to confirm, then delete the branch and redo.
- **Anything else** — stop for that repo and report it.

Treating the skill's own leftovers as user work strands repos that have real findings, which is the opposite of the intent.

## Step 3: Establish Baseline

Before changing dependencies:

1. **Enumerate every tracked lockfile and manifest with `git ls-files`.** Do not use `find`: it misses files deeper than whatever `-maxdepth` you picked and it picks up untracked build artifacts, vendored copies and agent worktrees that are not the repo's problem. Only tracked files ship.
2. Treat **each lockfile as its own scan target**, run from its own directory. A repo is not one scan. Monorepo packages covered by a root workspace lockfile scan together; a nested directory with its own lockfile does not, and is the easiest thing in this whole skill to miss.
3. Detect the package manager per lockfile, and discover validation commands from CI first, then package scripts, Makefile targets, language metadata, and README.
4. Run targeted baseline checks where available. Record failures but do not skip the repo only because baseline checks fail.
5. Run scanners and keep only high/critical findings.

Every lockfile enumerated in step 1 must appear in the final report as either scanned or explicitly out of scope, with the reason. An unaccounted-for lockfile is an unscanned lockfile.

Templates and scaffolds deserve extra attention: a lockfile under a `template/`, `starter/` or `examples/` directory is copied into user projects, so its vulnerabilities are distributed rather than merely local.

### Use both scanners, always

Ecosystem scanners and GitHub advisory data are complementary, not redundant — each routinely finds high-severity issues the other misses. Run both and reconcile:

- Establish whether Dependabot is even enabled with `gh api /repos/{owner}/{repo}/vulnerability-alerts` (204 = enabled, 404 = disabled). **A 403 or any other API error means "unknown", never "clean".** Conflating a permissions failure with an empty result silently marks vulnerable repos as safe.
- Where the two disagree, trust neither: check the specific package against the registry and the advisory record, then report the discrepancy.

Use scanner output plus package manifests/lockfiles to determine whether each finding is runtime or dev-only when possible.

## Step 4: Fix Findings

Before choosing a strategy, **confirm the patched version actually exists in the registry** (`npm view <pkg> versions`, or the ecosystem equivalent). Scanners report advisory metadata, and a "patched in X" range can name a version that was never published — in which case upgrading is not an option at all and you must jump to replacement. Do not plan an upgrade you have not confirmed is installable.

Where a finding spans several release lines, **fetch the authoritative ranges** with `gh api /advisories/<GHSA>` rather than inferring scope from which repos a scanner happened to flag. Scanners surface a finding only where their heuristics reach; the advisory record is what actually defines who is affected, and older major lines are frequently affected too.

Fix high/critical findings in this order:

1. Upgrade the direct dependency to the smallest patched version.
2. Upgrade the parent dependency that brings in a vulnerable transitive dependency.
3. Add an override/resolution only when the patched transitive version is plausibly compatible.
4. Attempt required breaking migrations when no non-breaking fix exists.
5. Replace abandoned packages when no maintained patched path exists.
6. Update GitHub Actions versions for high/critical workflow advisories.

Keep changes scoped to vulnerability remediation and required migrations. Do not perform unrelated refactors.

Editing an overrides/resolutions block can rewrite a large part of the lockfile, because it invalidates the cached resolution and the package manager re-renders the whole peer graph. That is expected and is not a reason to abandon a correct fix. Verify it is representation-only rather than eyeballing the diff size: extract the set of resolved `package@version` entries before and after and confirm nothing was added or removed. Report the churn so a large diff does not read as an unexplained change.

## Step 5: Validate

After changes:

1. Re-run the scanners **over the same set of lockfiles enumerated in Step 3**, with the same unfiltered dependency scope, and confirm no high/critical findings remain. Verifying a narrower scope than you discovered produces a false clean.
2. Check CI for hardcoded toolchain versions that override the manifest. A workflow that pins the tool version (for example `pnpm/action-setup` with an explicit `version:`, overriding `packageManager`) silently keeps installing the vulnerable version no matter what the manifest says. When the fix was a toolchain bump, the manifest and CI must agree; prefer removing the pin so CI reads the manifest and the two cannot drift apart again.
3. Run targeted checks first.
4. Run full validation after targeted checks: install/restore, lint/typecheck, tests, build, and smoke checks when discoverable.
5. Compare failures with the baseline. Pre-existing failures may remain; new failures block merge.

Validation passes only when high/critical findings are fixed and no new regressions appear. Low and moderate findings that remain are expected and do not block anything.

## Step 6: Commit, Push, Merge, Clean Up

When validation passes:

1. Commit with `fix: address high and critical CVEs`.
2. Push `security/fix-high-critical-cves`.
3. Merge the security branch into the default branch locally.
4. **Before pushing, confirm the default branch is ahead of origin only by commits this run created** (`git log origin/<branch>..<branch>`). If it carries anything else, another session may be working in that repo: do not push, leave the repo alone, and report it. Pushing the default branch publishes every local commit on it, not just yours, and someone else's unpushed work is not yours to release.
5. Push the default branch.
6. Delete the remote security branch.
7. Delete the local security branch.

If validation fails:

1. Record changed files and failing commands.
2. Restore the repo to the updated default branch state.
3. Delete the local security branch.
4. Delete the remote security branch if it was pushed.
5. Report the repo as not fixed.

## Step 7: Report

Print a Markdown report to stdout. Include:

- Summary counts: repos discovered, fixed and merged, skipped dirty, no high/critical findings, failed validation, unresolved.
- Per-repo result.
- Every lockfile enumerated in Step 3, marked scanned or out of scope with the reason. This is what makes a "clean" claim auditable rather than asserted.
- Any disagreement between ecosystem scanners and GitHub advisory data, and how it was resolved.
- CVE/GHSA/advisory ID, severity, package/action, vulnerable version, fixed version.
- Whether each finding was runtime, dev-only, workflow, or unknown.
- Changes made: dependency bumps, lockfile updates, overrides/resolutions, package replacements, workflow updates, migration edits.
- Commands run and outcomes.
- Branch/commit hash for fixed repos.
- Baseline failures that were present before the fix.
- Any unresolved risks or manual follow-up.

Keep the report factual. Do not write a report file unless the user explicitly asks.
