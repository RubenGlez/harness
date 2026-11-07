# Perf

A measured slowness to improve against a baseline. Principles: [prove it works](../../_shared/principles/prove-it-works.md), [fix root causes](../../_shared/principles/fix-root-causes.md), [attack the premise](../../_shared/principles/attack-the-premise.md).

1. Define the metric and how to measure it: what one sample is, how many samples, warm or cold, which build. Use a production-like build, not a dev server, unless dev is the complaint.
2. Measure the baseline. Report median and spread, not a single run.
3. Profile before changing anything (profiler, trace, query log). Name the limiter (CPU, I/O, network, rendering, a specific query) with evidence.
4. Change one thing that targets the limiter.
5. Re-measure with the identical method. Keep the change only if the gain is larger than the run-to-run noise. Explain the number: confirm it moved for the reason you think and not because of caching, a smaller input or a skipped code path.
6. Run static checks and the relevant tests; a faster wrong answer is a regression.
7. Report: metric, method, baseline vs after (median and spread), the limiter, and what you tried that didn't help.
