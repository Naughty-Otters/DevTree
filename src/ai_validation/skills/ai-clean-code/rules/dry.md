# DRY (Don’t Repeat Yourself)

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — general rules.

## Check
- Duplicated logic in the change that should share one abstraction
- Copy-paste blocks with tiny variations (prefer parameterization or shared helper)
- Needless repetition (code smell) — same rule expressed in multiple places
- Prefer reuse of existing project helpers before inventing parallel ones
- Do not force DRY: accidental duplication is OK; wrong abstraction is worse than a little copy

## Severity
- blocking: duplicated business rules that can diverge and cause bugs
- important: repeated non-trivial logic across new files in the change set
- nit: small repeated patterns that are still readable
