#!/usr/bin/env bash
# Seed .harness/ into a linked git worktree at session start.
#
# Manual parallel worktrees (`git worktree add`) start without .harness/ because it
# is gitignored — git never copies ignored files into a new worktree. Copy it from
# the main checkout so the session has the docs from the start, and snapshot a
# pristine .harness/.base/ that /update-docs uses as the merge base when deciding
# whether to promote this worktree's doc changes back to main.
#
# Idempotent: no-op in the main checkout, and no-op if .harness/ already exists.
# SessionStart — no stdin. Exits 0 always.

set -u

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

git_dir=$(git rev-parse --git-dir 2>/dev/null)
common_dir=$(git rev-parse --git-common-dir 2>/dev/null)

# In the main checkout git-dir == git-common-dir. Only act in linked worktrees.
[ "$git_dir" = "$common_dir" ] && exit 0

# Resolve the main checkout: the common dir is <main-root>/.git
case "$common_dir" in
  /*) abs_common="$common_dir" ;;
  *)  abs_common="$(cd "$common_dir" 2>/dev/null && pwd)" ;;
esac
[ -z "$abs_common" ] && exit 0

main_root=$(dirname "$abs_common")
src="$main_root/.harness"
dest="$(git rev-parse --show-toplevel)/.harness"

[ -d "$src" ] || exit 0      # nothing to seed from
[ -d "$dest" ] && exit 0     # already seeded

cp -R "$src" "$dest" || exit 0

# Pristine base for /update-docs 3-way reconciliation (exclude the base itself).
rm -rf "$dest/.base"
mkdir "$dest/.base"
find "$dest" -mindepth 1 -maxdepth 1 ! -name .base -exec cp -R {} "$dest/.base/" \;

echo "Seeded .harness/ into worktree from $src" >&2
exit 0
