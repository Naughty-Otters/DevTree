# Unit Tests

## Check
- Changed behavior has tests when the project already tests similar code
- Tests are readable and one-assert-intent clear (FIRST / clean tests)
- Avoid fragile tests coupled to incidental structure
- Missing tests for risky new logic → warn with concrete suggested cases

## Severity
- blocking: clearly broken or empty tests added with the change
- important: risky new logic with no coverage where peers are tested
- nit: extra edge-case suggestions
