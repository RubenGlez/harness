# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-26

Initial release of the harness Claude Code plugin.

### Added
- End-to-end product workflow skills: `/ideate`, `/product-plan`, `/dev-plan`,
  `/implement`, `/qa`, `/update-docs`, and `/ship`.
- Incremental-change skills for shipped products: `/task` and `/evolve`.
- Adoption and maintenance skills: `/migrate-docs`, `/next-step`,
  `/improve-codebase-architecture`, and `/write-a-skill`.
- `/address-cves` skill for auditing and patching dependency CVEs across repos.
- Private `.harness/` documentation structure (product, engineering, adr, qa)
  that stays gitignored and is propagated across git worktrees.
- Distributed via the git marketplace; no npm publish step.
