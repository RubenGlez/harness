# Refactor

Behavior stays identical; only structure changes (rename, extract, inline, dedupe, move). Principles: [subtract before you add](../../_shared/principles/subtract-before-you-add.md), [sequence verifiable units](../../_shared/principles/sequence-verifiable-units.md), [prove it works](../../_shared/principles/prove-it-works.md).

1. Pin the current behavior: find the tests that cover the code you'll touch and run them green. If coverage is thin, add a characterization test through the public interface first, and commit it on its own.
2. Name the target shape in one or two sentences (what moves where, what gets deleted). If you need a script or codemod for repetitive edits, write that instead of editing by hand.
3. Delete first: dead code, unused exports and redundant wrappers in the area.
4. Make the change in small units, each one building and passing the pinned tests before the next. Migrate every caller and delete the old path in the same change; no compatibility shims.
5. Rerun static checks and the full pinned test set. Any behavior difference is a bug in the refactor, not a spec change.
6. If the refactor reveals a design problem bigger than this task, stop and recommend `/improve-codebase-architecture`.
