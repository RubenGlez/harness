# QA — Reference

## Report Template

```
# QA Report — [YYYY-MM-DD]

## Summary
- Features tested: N
- All criteria passed: N
- Criteria with failures: N
- Failures auto-fixed: N
- Outstanding issues: N

## Results by feature

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
