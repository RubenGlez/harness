# Fix root causes

**When:** debugging anything.

Walk each symptom back to the first place the system went wrong and fix it there.

- Reproduce first, on the same surface the user saw it. No repro, no fix.
- Ask "why did this state exist?" until the answer is code you own, not another symptom.
- A guard (null check, retry, try/catch, clamp) is a fix only when the state it handles is legitimate. If the state should never happen, the fix belongs upstream where it was created.
- One root cause often explains several symptoms. Check the siblings before closing.
