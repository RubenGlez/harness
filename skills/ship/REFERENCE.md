# Ship — Reference

## Changelog entry format

Prepend to `CHANGELOG.md`, keeping previous entries below ([Keep a Changelog](https://keepachangelog.com) style):

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- [user-visible feature, one line each]

### Changed
- [behavior changes existing users will notice]

### Fixed
- [bugs fixed, described by symptom, not by cause]
```

Rules:
- Describe what the *user* gets, not what the code does ("Export projects as CSV", not "Add CsvSerializer")
- Omit empty sections
- Internal refactors, dependency bumps, and CI changes don't belong in the changelog unless they change behavior

## Tag message format

When there is no `CHANGELOG.md`, the annotated tag carries the notes:

```
v[X.Y.Z]

Added:
- ...
Fixed:
- ...
```

## Announcement template

One short paragraph plus bullets — written for users, not developers:

```markdown
[Product] v[X.Y.Z] is out.

[One sentence: the headline improvement and who benefits.]

- [benefit 1 — outcome, not feature name]
- [benefit 2]
- [benefit 3, max]

[Link to product / changelog]
```

Keep it under 100 words. No exclamation marks doing the enthusiasm's job, no "we're excited to announce".
