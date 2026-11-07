# Bug fix

The spec is right, the code is wrong. Principles: [fix root causes](../../_shared/principles/fix-root-causes.md), [attack the premise](../../_shared/principles/attack-the-premise.md), [prove it works](../../_shared/principles/prove-it-works.md).

1. Reproduce the bug on the surface the user saw it (browser, CLI, API, simulator). Record the exact steps and the wrong output. Can't reproduce → stop and report what you tried; don't guess a fix.
2. Capture the repro as the cheapest failing check: a failing test if the suite makes it cheap, otherwise a short script. Run it and confirm it fails for the reported reason.
3. Find the root cause: trace the bad state back to where it was first created. Write it in one sentence before touching code.
4. Fix it at the root. Add a guard only if the state it handles is legitimate.
5. If two fixes fail the same check, stop and test the premise they share before a third attempt.
6. Rerun the failing check (now green), the static checks and the narrowest relevant tests. Then repeat step 1's repro on the real surface.
7. Look for siblings: other call sites that hit the same root cause. Fix them only if they're part of this bug; otherwise list them in the report.
