# QA — Reference

## Report Template

The report stays small forever: a run-summary table (one row per run, newest last) plus ONLY the latest run's detail. Older detail sections are deleted when a new run is written — the history is in git.

```
# QA Report

## Run summary

| Date | Phase / scope | Features tested | Passed | Failed | Fixed | Open |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | Phase 1 | N | N | N | N | N |

## Latest run — YYYY-MM-DD (Phase 1)

### [Feature name]
- ✅ [Criterion] — [how it was verified]
- ❌ [Criterion] — [what was observed] — **fixed**: yes / no

## Outstanding issues

### [Issue title]
**Feature**: [name]
**Criterion**: [which acceptance criterion failed]
**Failure**: [what went wrong]
**Root cause**: [if known]
**Required fix**: [what needs to happen]

## Architectural gaps
Patterns in the failures that point to a structural problem rather than a bug:
- [gap] — [which failures suggest it] — [suggested ADR or refactor]
```
