# Attack the premise

**When:** two fixes that share an assumption have failed the same check.

Stop writing fixes. Write the shared assumption down in one sentence ("the handler runs once per click", "the cache is cold here") and test that sentence directly, with a log line, a probe script or a debugger. Only write the next fix once the premise is confirmed or replaced.

Third attempts built on an unchecked premise are where most debugging time goes.
