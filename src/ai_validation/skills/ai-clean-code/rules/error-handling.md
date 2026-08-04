# Error Handling

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — error handling.

## Check
- Do not mix error handling with normal flow — extract or isolate error paths
- Errors are handled, not ignored (empty catch, discarded Result, swallowed promise)
- Prefer exceptions/Results for exceptional flow — not error codes mixed with data
- Do not return null or pass null when an error object or exception is clearer
- Add context when wrapping or propagating errors (stage, values, intent)
- Map foreign/third-party errors to project conventions at boundaries
- Fail fast on invalid preconditions in changed APIs
- Do not use exceptions for normal control flow

## Severity
- blocking: swallowed errors that hide failures in the change
- important: lost error context, null returns on failure, or overly broad catches
- nit: clearer error messages or more specific exception types
