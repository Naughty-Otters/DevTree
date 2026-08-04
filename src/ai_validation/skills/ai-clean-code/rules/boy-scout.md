# Boy Scout Rule

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — general rules.

> “Leave the campground cleaner than you found it.” — Robert C. Martin

## Check
- Leave touched code a bit cleaner than you found it (without drive-by mega-refactors)
- Prefer small clarifying renames or extracts in the same hunk over large unrelated rewrites
- Fix obvious nearby issues (typos, dead imports, stale comments) when touching a file
- Avoid gold-plating beyond the change’s purpose
- If surrounding mess blocks the change, note a focused follow-up rather than boiling the ocean

## Severity
- blocking: large unrelated refactors mixed into a behavior change (reviewability risk)
- important: change worsens clarity of surrounding code
- nit: small scout improvements that were missed in touched files
