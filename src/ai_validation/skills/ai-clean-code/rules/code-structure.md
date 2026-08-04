# Source Code Structure

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — organization and formatting.

## Check
- Separate concepts vertically — blank lines between unrelated blocks in touched files
- Related code appears vertically dense (helpers near callers, fields near methods that use them)
- Declare variables close to first use in changed functions
- Dependent functions closed together; caller above callee when reordering is reasonable
- High-level code first in a file, details toward the bottom (newspaper style)
- Keep lines reasonably short (~70–120 chars); split long expressions across lines
- Use whitespace to group related statements; do not break indentation
- Avoid horizontal alignment padding that fights the formatter
- Avoid files growing far beyond project norms in the same change (ideal < 1000 lines)

## Severity
- blocking: structural changes that make the diff unreadable or break project layout conventions
- important: variables declared far from use, or callers/callees scattered across large files
- nit: line length, spacing, or ordering improvements in the touched hunk
