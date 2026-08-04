# Code Smells & Heuristics

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — code smells.

## Check (in the change set)
- Rigidity: small change forces cascading edits elsewhere
- Fragility: one change breaks unrelated areas
- Immobility: code cannot be reused without high risk or effort
- Needless complexity or repetition introduced in the diff
- Opacity: code is hard to understand without deep context
- Feature envy, data clumps, long parameter lists
- Speculative generality / dead abstractions added “just in case”
- Inappropriate intimacy between modules
- Switch/if pyramids that should be polymorphism or lookup tables
- Magic numbers/strings without named constants where meaning matters

## Severity
- blocking: smells that likely introduce bugs or unsafe coupling
- important: new smells that hurt readability or maintainability of the change
- nit: optional cleanups adjacent to the hunk
