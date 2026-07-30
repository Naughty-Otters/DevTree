# Functions

## Check
- Small: prefer short, focused functions in changed code
- Do one thing; one level of abstraction per function
- Few arguments (0–2 ideal; avoid long parameter lists — use objects/options)
- No flag arguments that switch unrelated behaviors
- Side effects are obvious from the name; avoid hidden I/O in “pure-looking” helpers
- Prefer early returns over deep nesting

## Severity
- blocking: multi-purpose functions that mix unrelated responsibilities in the change
- important: long/nested functions that hide the change intent
- nit: extractable helpers that would clarify a hunk
