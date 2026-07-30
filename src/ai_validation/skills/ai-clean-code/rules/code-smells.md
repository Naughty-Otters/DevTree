# Code Smells & Heuristics

## Check (in the change set)
- Feature envy, data clumps, long parameter lists
- Speculative generality / dead abstractions added “just in case”
- Inappropriate intimacy between modules
- Switch/if pyramids that should be polymorphism or tables
- Magic numbers/strings without named constants where meaning matters

## Severity
- blocking: smells that likely introduce bugs or unsafe coupling
- important: new smells that hurt readability of the change
- nit: optional cleanups adjacent to the hunk
