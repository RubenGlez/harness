# Address CVEs Reference

Use this reference only after `address-cves` is triggered and a repo's ecosystem is known.

## Scanner Selection

Always filter to high and critical findings before deciding work. Low and moderate are noise: report them as counts at most, never act on them.

**Never narrow a scan to production dependencies.** Do not add `--prod`, `--omit=dev`, `--production` or an equivalent to any discovery or verification scan. Those flags belong to CI gates, whose job is to block a release; this skill's job is to find everything high or critical, and dev-scope findings are in scope. A prod-filtered scan happily reports "clean" while high-severity dev findings sit untouched — a real and easy way to certify a repo you have not actually checked.

The two filters are independent and pull in opposite directions: severity narrow (high/critical only), dependency scope wide (runtime and dev).

OSV-Scanner is a Go binary, not an npm package. Install it with `brew install osv-scanner` or run it ad hoc with `go run github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`. Where this reference says `osv-scanner scan ...`, substitute the `go run ...` form if you have not installed the binary.

### GitHub advisories

Use Dependabot data *alongside* ecosystem scanners, not as a fallback for them. In practice each finds high-severity issues the other misses: scanners walk the resolved tree in full, while Dependabot re-scans on its own schedule and covers manifests a per-directory scan can skip.

- Check whether alerts are even on: `gh api /repos/{owner}/{repo}/vulnerability-alerts` returns 204 (enabled) or 404 (disabled). Listing the alerts themselves needs the `admin:repo_hook` scope.
- **An API error is not an empty result.** A 403, a missing scope or a disabled-alerts response means "unknown" and must be reported as such. Recording it as "no findings" marks vulnerable repos as clean.
- Advisory ranges are authoritative; scanner-reported ranges are not. Fetch the record with `gh api /advisories/<GHSA>` when the exact affected range matters — especially to check whether older major lines are affected too.
- Prefer Dependabot's `first_patched_version` when it disagrees with a scanner: it correctly reports `none` for advisories with no published fix, where scanners may name a version that does not exist.
- Use advisory IDs (`CVE-*`, `GHSA-*`) in the report.

### JavaScript and TypeScript

Enumerate lockfiles with `git ls-files`, not `find`, and scan each one from its own directory. A root workspace lockfile covers its member packages; a nested lockfile is a separate scan and is the most commonly missed target in this ecosystem. Repos with no tracked manifest at all can be dismissed immediately from the same listing.

The package manager version itself can be a finding. When it is pinned in `packageManager`, or vendored into the lockfile under `packageManagerDependencies`, it is a locked dependency like any other and advisories against it apply. A vendored copy also has to be removed from the lockfile, not just bumped in the manifest.

Detect package manager by lockfile:

- `package-lock.json` or `npm-shrinkwrap.json`: use npm commands.
- `pnpm-lock.yaml`: use pnpm commands through Corepack or existing repo tooling.
- `yarn.lock`: use the repo's Yarn version.
- `bun.lockb` or `bun.lock`: use Bun if available; otherwise report scanner gap.

Preferred scanner commands:

- npm: `npm audit --json --audit-level=high`
- pnpm: `pnpm audit --json --audit-level high`
- Yarn modern: `yarn npm audit --severity high --json`
- Yarn classic: `yarn audit --level high --json`
- OSV fallback: `osv-scanner scan --format=json .`

Fix strategy:

- Prefer `npm update <pkg>`, `npm install <pkg>@<patched-range>`, `pnpm up`, or `yarn up` consistent with the repo package manager.
- For transitive npm issues, prefer upgrading the direct parent. Use `overrides` only when needed.
- For Yarn, use `resolutions` where appropriate.
- For pnpm, use `pnpm.overrides` in `package.json`, or the `overrides` block in `pnpm-workspace.yaml` when the repo already keeps them there.
- Do not switch package managers.

Try a plain lockfile refresh (`pnpm update <pkg> --recursive --depth Infinity` or the npm equivalent) before reaching for an override. Parents frequently already allow the patched version and only the lockfile is stale, which fixes the finding with no new maintenance debt.

An override is only justified when a parent pins a range that excludes the fix. Scope it so it cannot force an unrelated major onto other consumers, and check first whether several majors of the package coexist in the tree. Beware near-miss names when checking: `gaxios` and `retry-axios` are not `axios`.

When an override is added, record what has to change upstream for it to go away. To retire one later, do not reason from registry metadata — remove it, reinstall, and read the version that actually resolves.

### Python

Detect from `pyproject.toml`, `requirements*.txt`, `Pipfile.lock`, `poetry.lock`, `uv.lock`, or `pdm.lock`.

Preferred temporary scanners:

- `uvx pip-audit --format json`
- `pipx run pip-audit --format json`
- `python -m pip_audit --format json` only if already installed
- `osv-scanner scan --format=json .` as fallback

Fix strategy:

- Preserve the repo's dependency manager: Poetry, uv, pip-tools, PDM, Pipenv, or raw requirements.
- Update lockfiles with the native tool.
- Prefer minimum patched versions and keep Python version constraints intact.

### Ruby

Detect from `Gemfile.lock` and `Gemfile`.

Preferred scanners:

- `bundle audit check --format json` if already available in the bundle.
- `gem exec bundler-audit check --update` as a temporary runner — this is the Ruby equivalent of `npx`/`uvx` and needs no change to the Gemfile.
- `osv-scanner scan --format=json .` as fallback.

Fix strategy:

- Use `bundle update <gem> --patch` when practical.
- Preserve Ruby and Bundler versions.

### Go

Detect from `go.mod`.

Preferred scanners:

- `govulncheck ./...` if available.
- `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` as temporary runner.
- `osv-scanner scan --format=json .` as fallback.

Fix strategy:

- Use `go get module@patched-version` and `go mod tidy`.
- Keep major module path rules intact.

### Rust

Detect from `Cargo.lock` and `Cargo.toml`.

Preferred scanners:

- `cargo audit --json` if available.
- If not available, use `cargo install` only in a temporary cargo home when feasible; otherwise use OSV fallback.
- `osv-scanner scan --format=json .` as fallback.

Fix strategy:

- Use `cargo update -p crate --precise version`.
- Preserve feature flags and workspace constraints.

### GitHub Actions

Detect from `.github/workflows/*.yml` and `.github/workflows/*.yaml`.

Scan with GitHub advisory data when available and OSV fallback when useful. Update actions to the smallest safe patched tag or SHA. Prefer pinned full-length SHAs when the repo already pins SHAs; otherwise preserve the repo's existing tag/SHA style.

## Validation Command Discovery

Prefer commands in this order:

1. CI workflows for default branch checks.
2. Makefile targets such as `test`, `lint`, `typecheck`, `build`, `check`.
3. Package scripts such as `test`, `lint`, `typecheck`, `build`.
4. Language defaults: `go test ./...`, `cargo test`, `pytest`, `bundle exec rspec`.
5. README instructions if they are precise and current.

Run targeted checks first:

- JS/TS: affected package tests or workspace filter when identifiable.
- Python: affected test file/package if clear, otherwise scanner plus import/build checks.
- Go/Rust: package-level tests for changed modules.
- GitHub Actions only: YAML validation or workflow linter if present, then repo tests if dependency files changed.

Run full validation after targeted checks. New failures block merge; pre-existing baseline failures must be reported separately.

## Branch and Cleanup Details

Use branch `security/fix-high-critical-cves`.

Before creating the branch, verify the local default branch matches the remote. If it cannot be fast-forwarded safely, skip the repo and report it.

If the security branch already exists locally or remotely, inspect its commits. If it is already merged, delete it. If it carries unmerged commits, tell the two cases apart rather than skipping on sight: leftovers from an earlier run of this skill (its own commit subject plus a `Claude-Session` trailer from another session) are stale and should be discarded and rebuilt after confirming with the user, while anything else is user work and means skipping the repo. See Step 2 in SKILL.md.

After a failed fix, restore with non-destructive commands where possible. Do not remove user changes. If cleanup would require discarding work not created during this run, stop and report the cleanup blocker.

## Report Vocabulary

Use these result labels:

- `fixed-merged`: changes validated, committed, pushed, merged to default branch, and branch deleted.
- `no-severe-findings`: scanners found no high/critical app dependency or workflow findings.
- `skipped-dirty`: local worktree had uncommitted changes.
- `skipped-preflight`: auth, clone, branch, or default-branch setup failed.
- `failed-validation`: fix attempted but validation failed or introduced new regressions.
- `unresolved`: no safe fix was found or migration could not be completed.

Use these dependency scopes:

- `runtime`
- `dev-only`
- `workflow`
- `unknown`
