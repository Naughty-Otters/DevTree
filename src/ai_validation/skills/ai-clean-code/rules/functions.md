# Functions

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — function rules.

## Check
- Small and focused — ideally fits on screen without scrolling; one level of abstraction
- Do one thing; side effects must be obvious from the name
- Few arguments (0–3 ideal); use options objects for larger parameter sets
- No flag arguments that switch unrelated behaviors — split into separate functions
- Prefer early returns over deep nesting; avoid nested control structures
- Error handling is one thing — keep try/catch blocks focused
- Prefer exceptions/Results over error codes mixed with success data at lower levels
- Avoid switch/if pyramids where polymorphism or lookup tables fit better
- Command or query, not both — setters return void; boolean functions answer yes/no
- Keep boolean functions in positive tone (`isActive`, not `isInactive`)
- Avoid output arguments; prefer return values or mutating `this`/receiver clearly
- Readable top-to-bottom as a paragraph; related functions grouped together

## Severity
- blocking: multi-purpose functions mixing unrelated responsibilities in the change
- important: long/nested functions or flag arguments that hide change intent
- nit: extractable helpers that would clarify a hunk
