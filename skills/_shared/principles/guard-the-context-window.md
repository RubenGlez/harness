# Guard the context window

**When:** a step would pull large output, long files or many repeated reads into the main thread.

Send bulk work to a subagent and keep only its summary here. Pass file paths, not file contents. Ask the subagent for a short, structured result (verdict, evidence, file:line), not a dump.

You still own what a subagent returns: read its diff or evidence before you repeat its claim.
