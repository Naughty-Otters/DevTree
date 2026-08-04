# Unit Tests

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — test rules.

## Check
- Changed behavior has tests when the project already tests similar code
- Tests are FIRST: Fast, Independent, Repeatable, Self-validating, Timely
- One clear assertion intent per test (focused scenario, readable name)
- Tests are readable — arrange/act/assert structure where the project uses it
- Avoid fragile tests coupled to incidental structure or implementation details
- Easy to run locally; no hidden global state between tests
- Missing tests for risky new logic → warn with concrete suggested cases
- Use coverage tools where the project already does — do not demand new infra in the diff

## Severity
- blocking: clearly broken, empty, or misleading tests added with the change
- important: risky new logic with no coverage where peers are tested
- nit: extra edge-case or readability suggestions
