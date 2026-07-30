# Error Handling

## Check
- Errors are handled, not ignored (empty catch / discarded Result)
- Prefer exceptions/Results for exceptional flow — not return codes mixed with data
- Add context when wrapping/propagating errors
- Fail fast on invalid preconditions in changed APIs
- Do not use exceptions for normal control flow

## Severity
- blocking: swallowed errors that hide failures in the change
- important: lost error context or overly broad catches
- nit: clearer error messages
