
# Universal Quality

Use on every non-trivial review. Inspired by code-quality-universal patterns.

## Check

- **Reuse:** does an existing helper already do this? Search adjacent modules before accepting new utilities
- **Parameter sprawl:** too many params → struct/options object
- **Leaky abstractions:** callers shouldn't need internals of DSM/analysis/DB layers
- **Nested conditionals:** prefer early returns / guard clauses
- **Stringly-typed:** avoid magic strings for enums/modes when types exist
- **TOCTOU:** check-then-act on files/locks without synchronization
- **No-op updates:** writes that don't change state / redundant store sets
- **Redundant state:** single source of truth (don't mirror the same flag in 3 places)

## Severity hints

- 🔴 Incorrect abstraction that will corrupt state or duplicate divergent logic
- 🟡 Maintainability debt likely to cause bugs soon
- 🟢 Style / mild clarity
