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
- Address only high and critical vulnerabilities.
- Include runtime and dev dependencies; label dev-only findings when detectable.
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

Do not overwrite user work. If the branch already exists and contains unmerged local work, stop for that repo and report it.

## Step 3: Establish Baseline

Before changing dependencies:

1. Detect the project type and package managers from lockfiles, manifests, CI, and Makefiles.
2. Discover validation commands from CI first, then package scripts, Makefile targets, language metadata, and README.
3. Run targeted baseline checks where available. Record failures but do not skip the repo only because baseline checks fail.
4. Run scanners and keep only high/critical findings.

Use scanner output plus package manifests/lockfiles to determine whether each finding is runtime or dev-only when possible.

## Step 4: Fix Findings

Fix high/critical findings in this order:

1. Upgrade the direct dependency to the smallest patched version.
2. Upgrade the parent dependency that brings in a vulnerable transitive dependency.
3. Add an override/resolution only when the patched transitive version is plausibly compatible.
4. Attempt required breaking migrations when no non-breaking fix exists.
5. Replace abandoned packages when no maintained patched path exists.
6. Update GitHub Actions versions for high/critical workflow advisories.

Keep changes scoped to vulnerability remediation and required migrations. Do not perform unrelated refactors.

## Step 5: Validate

After changes:

1. Re-run the scanners and confirm no high/critical targeted findings remain.
2. Run targeted checks first.
3. Run full validation after targeted checks: install/restore, lint/typecheck, tests, build, and smoke checks when discoverable.
4. Compare failures with the baseline. Pre-existing failures may remain; new failures block merge.

Validation passes only when high/critical findings are fixed and no new regressions appear.

## Step 6: Commit, Push, Merge, Clean Up

When validation passes:

1. Commit with `fix: address high and critical CVEs`.
2. Push `security/fix-high-critical-cves`.
3. Merge the security branch into the default branch locally.
4. Push the default branch.
5. Delete the remote security branch.
6. Delete the local security branch.

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
- CVE/GHSA/advisory ID, severity, package/action, vulnerable version, fixed version.
- Whether each finding was runtime, dev-only, workflow, or unknown.
- Changes made: dependency bumps, lockfile updates, overrides/resolutions, package replacements, workflow updates, migration edits.
- Commands run and outcomes.
- Branch/commit hash for fixed repos.
- Baseline failures that were present before the fix.
- Any unresolved risks or manual follow-up.

Keep the report factual. Do not write a report file unless the user explicitly asks.
