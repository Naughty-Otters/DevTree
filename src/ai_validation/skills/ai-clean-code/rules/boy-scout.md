# Boy Scout Rule

## Check
- Leave touched code a bit cleaner than you found it (without drive-by mega-refactors)
- Prefer small clarifying renames/extracts in the same hunk over large unrelated rewrites
- Avoid gold-plating beyond the change’s purpose
- If a surrounding mess blocks the change, note a focused follow-up rather than boiling the ocean

## Severity
- blocking: large unrelated refactors mixed into a behavior change (reviewability risk)
- important: change worsens clarity of surrounding code
- nit: small scout improvements that were missed
