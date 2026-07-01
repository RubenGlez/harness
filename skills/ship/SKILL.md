---
name: ship
description: Release the current state of the project — pre-flight checks, version bump and tag, changelog entry, deploy, and an optional announcement draft. Use after qa has passed and docs are updated, or when the user wants to ship, release, deploy, publish, or cut a version.
---

# Ship

Shipping is outward-facing and hard to reverse. Never deploy, push a tag, or publish without explicit user approval of the release plan (Step 3).

## Step 1: Pre-flight

Verify the project is releasable:

- `.harness/qa/report.md` — the latest report should have no open issues. If it does, list them and ask whether to ship anyway.
- `git status` — working tree must be clean and on the main (or designated release) branch. Uncommitted changes block the release.
- If `.doctier.yml` exists: run `doctier check`. A non-zero exit means a misclassified or plaintext-committed doc — this blocks the release.
- Run the project's static checks and test suite one final time. Any failure blocks the release.
- For **tag-triggered pipelines** (EAS Workflows, GitHub Actions releases, etc.): confirm the most recent pipeline run on the main branch passed before tagging. A broken pipeline consumes a version number — every retry needs a new tag. If the last run failed, investigate and fix the pipeline config in a commit *before* the release commit, then verify it passes. Where the tooling supports it, validate the pipeline config locally before committing (e.g. `eas build --dry-run` for EAS, schema linters for GitHub Actions) — a config validation error caught locally is cheaper than a burned version number.
- **License**: a public repo should carry a license file. If no `LICENSE` / `LICENSE.md` / `LICENSE.txt` exists, offer to add one — recommend MIT (fill in the author name and current year) but let the user choose another or decline. Never pick a license silently; it is a legal decision. This does not block the release — if the user declines, proceed and record the choice in `AGENTS.md` under "Release" (e.g. "intentionally unlicensed") so future runs don't re-ask.

If any check fails, stop and report — do not work around it.

## Step 2: Determine the release procedure

Look for an existing procedure, in order:

1. `AGENTS.md` — a "Release" or "Deploy" section from a previous /ship run
2. Deploy config in the repo: `vercel.json`, `fly.toml`, `netlify.toml`, `Dockerfile` + compose, `eas.json` / fastlane, `publishConfig` in package.json, a `deploy` script or Makefile target, a deploy workflow in `.github/workflows/`
3. If nothing is found: ask the user what "deploying" means for this project (command, platform, manual steps), then record the answer in `AGENTS.md` under a "Release" section so future runs skip this question.

## Step 3: Propose the release plan

Determine the version bump from what shipped since the last tag (`git log <last-tag>..HEAD` and the feature specs): breaking → major, features → minor, fixes only → patch. If there is no version scheme yet, propose starting at `0.1.0`.

Present the plan and wait for approval:

> Releasing **v1.3.0**:
> - Features: [list from specs/commits]
> - Fixes: [list]
> - Deploy: [procedure from Step 2]
> - Changelog: [will update CHANGELOG.md / will include notes in tag message]
>
> Proceed?

## Step 4: Version, changelog, tag

After approval:

1. Bump the version in the manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, ...).
2. If `CHANGELOG.md` exists, prepend the entry (see [REFERENCE.md](REFERENCE.md) for format). If it doesn't exist, put the release notes in the tag message instead — don't create new doc files unasked.
3. Commit the bump, create an annotated tag `v[X.Y.Z]`, and push branch + tag.

## Step 5: Deploy and verify

Run the procedure from Step 2. Then verify the release where it actually runs — pick the strongest available signal:

- Web: hit the production URL or health endpoint; load the key page that shipped
- API: curl the live endpoint for one shipped behavior
- Package: install the published version in a temp dir and import/run it
- Mobile: confirm the build was submitted/accepted by the store tooling

A deploy command exiting 0 is not verification. If verification fails, report immediately and ask whether to roll back — do not retry blindly.

## Step 6: Record the release

- Update `.harness/product/roadmap.md`: mark the shipped phase/features with the version and date.
- If the deploy procedure differed from what `AGENTS.md` documented, update that section.

## Step 7: Announcement draft (optional)

Offer once: a short announcement based on the changelog entry — user-facing benefits, not implementation details (see [REFERENCE.md](REFERENCE.md) for the template). Skip silently if the user declines.

## Step 8: Recommend next step

- Shipped clean: "Run /implement for the next phase, or /ideate if the roadmap is done."
- Shipped with known open issues: list them as candidates for the next phase.
- Verification failed: the rollback/fix decision comes first; recommend /qa after.
