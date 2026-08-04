# General Rules

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — general principles.

## Check
- Follow project/team standard conventions (naming, formatting, folder layout)
- Keep it simple (KISS): prefer the simplest solution that meets the change’s goal
- Principle of Least Surprise: code behaves as a reader would expect from names and structure
- Find root causes — avoid band-aid fixes that mask underlying problems
- Do not disable or bypass safeties (linters, type checks, auth guards, bounds checks) without strong justification
- DRY where duplication would cause divergence; do not force abstraction for trivial repetition
- Boy Scout rule: leave touched code slightly cleaner without unrelated mega-refactors

## Severity
- blocking: disabled safeties or fixes that hide root causes and risk regressions
- important: unnecessary complexity or surprising behavior introduced in the change
- nit: small simplifications or convention nits adjacent to the hunk
