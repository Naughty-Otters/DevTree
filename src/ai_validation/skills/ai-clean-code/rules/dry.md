# DRY (Don’t Repeat Yourself)

## Check
- Duplicated logic in the change that should share one abstraction
- Copy-paste blocks with tiny variations (prefer parameterization)
- Do not force DRY: accidental duplication is OK; wrong abstraction is worse
- Prefer reuse of existing project helpers before inventing parallel ones

## Severity
- blocking: duplicated business rules that can diverge and cause bugs
- important: repeated non-trivial logic across new files
- nit: small repeated patterns that are still readable
