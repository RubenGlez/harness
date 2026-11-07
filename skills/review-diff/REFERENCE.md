# Review diff reference

## Smell baseline

From Fowler's *Refactoring* (ch. 3). Always a judgement call, labelled "possible X", never a hard violation. A documented repo standard that endorses the pattern suppresses it.

| Smell | What it is | Fix |
|---|---|---|
| Mysterious Name | Name doesn't reveal what it does or holds | Rename; if no honest name comes, the design is murky |
| Duplicated Code | Same logic shape in more than one hunk or file | Extract the shared shape |
| Feature Envy | Function reaches into another object's data more than its own | Move it onto that data |
| Data Clumps | Same few fields or params keep travelling together | Bundle them into one type |
| Primitive Obsession | A string or number standing in for a domain concept | Give the concept its own small type |
| Repeated Switches | Same `switch`/`if` cascade on the same type in several places | One shared map, or polymorphism |
| Shotgun Surgery | One logical change forces edits across many files | Gather what changes together into one module |
| Divergent Change | One module edited for several unrelated reasons | Split so each changes for one reason |
| Speculative Generality | Params, hooks or abstractions the spec doesn't need | Delete; inline until a real need shows |
| Message Chains | Long `a.b().c().d()` navigation | Hide the walk behind one method |
| Middle Man | Function or class that mostly delegates | Call the real target directly |
| Refused Bequest | Subclass ignores most of what it inherits | Use composition |

## Standards brief

> Review this diff for conformance only. Report, per file and hunk: (a) every place it breaks a documented standard, citing the file and the rule, and (b) any baseline smell, named and with the hunk quoted. Mark documented-standard breaches as hard or judgement; baseline smells are always judgement. A documented standard overrides the baseline. Skip anything a linter or typechecker enforces. Don't comment on whether the feature is correct. Read-only: don't edit files. Under 400 words.

Paste the smell table above into the brief; the subagent can't see this file otherwise.

## Spec brief

> Review this diff against the spec only. Report: (a) requirements or acceptance criteria that are missing or partial, (b) behavior in the diff the spec didn't ask for (scope creep), (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Don't comment on style. Read-only: don't edit files. Under 400 words.
