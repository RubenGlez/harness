# Encode lessons in structure

**When:** you're about to write the same instruction, review comment or correction a second time.

Text gets skipped; structure doesn't. Turn the lesson into something that fails on its own, in this order of preference:

1. Architecture that makes the mistake impossible (one owner, one way to do it, delete the old way).
2. Types that make the bad state unrepresentable.
3. A lint, hook or CI check whose error names the fix.
4. A test that fails when the behavior breaks.
5. Docs or agent rules, last, and only for real judgment calls.

Prove the new check fails on a real past mistake before trusting it.
