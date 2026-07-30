
# Common Bugs

## Check

- Empty collections / missing optional values (`null`, `undefined`, `None`)
- Off-by-one in slices, ranges, matrix indices (DSM upper/lower triangle)
- Integer overflow / casting surprises (sizes, line numbers)
- Incorrect equality for floats or object identity vs value
- Forgotten `break`/`return` in search loops
- Stale closures capturing old state in TS event handlers
- Rust: partial moves, lifetime mistakes masked by clones
- Timezones / RFC3339 parsing assumptions
- Default/fallback paths that silently hide misconfiguration

## Ask

- What if the project has 0 packages / 1 file / a cycle / missing scope graph?
- What if the user cancels mid-analysis?

## Severity

- 🔴 Wrong results or panics on realistic inputs
- 🟡 Edge case likely in the wild
- 🟢 Theoretical only
