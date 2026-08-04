# Comments

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — comment rules.

## Check
- Prefer self-explanatory code over comments that narrate the obvious
- Good comments: intent, trade-offs, non-obvious constraints, warnings of consequences
- Bad: redundant narration (`i++` // increment i), noise, humor, changelog in code
- Do not leave commented-out code in the diff — use version control instead
- No closing-brace comments (`} // end of function`)
- Outdated or misleading comments in touched regions are failures
- TODOs include context (why, ticket, owner) or belong in issue tracking
- Use comments for complex business logic the code cannot express alone

## Severity
- blocking: misleading comments that contradict the code
- important: large dead commented-out blocks added in the change
- nit: redundant narrating comments
