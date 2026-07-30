# Comments

## Check
- Prefer clarifying code over explaining bad code with comments
- Good: intent, trade-offs, non-obvious constraints, public contract notes
- Bad: narrating what the next line does; commented-out dead code left in the diff
- Outdated/wrong comments in touched regions are failures
- TODOs should include context (why/owner/ticket) or be tracked elsewhere

## Severity
- blocking: misleading comments that contradict the code
- important: large dead commented-out blocks added in the change
- nit: redundant narrating comments
