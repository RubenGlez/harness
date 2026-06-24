# Address CVEs Reference

Use this reference only after `address-cves` is triggered and a repo's ecosystem is known.

## Scanner Selection

Always filter to high and critical findings before deciding work.

OSV-Scanner is a Go binary, not an npm package. Install it with `brew install osv-scanner` or run it ad hoc with `go run github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`. Where this reference says `osv-scanner scan ...`, substitute the `go run ...` form if you have not installed the binary.

### GitHub advisories

- Use Dependabot/security alert data when available through `gh`.
- If an API call is unavailable because of permissions or plan limits, report that and continue with ecosystem scanners.
- Use advisory IDs (`CVE-*`, `GHSA-*`) in the report.

### JavaScript and TypeScript

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
- For pnpm, use `pnpm.overrides`.
- Do not switch package managers.

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

- `bundle audit check --format json` if available.
- Temporary install only outside the project if needed, then run without adding it to the bundle.
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

If the security branch already exists remotely, inspect it. If it is from a prior run and already merged, delete it. If it contains unmerged work, skip the repo and report the conflict.

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
