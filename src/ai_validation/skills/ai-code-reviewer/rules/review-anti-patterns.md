
# Anti-Pattern Review

Based on [code-review best practices](https://github.com/awesome-skills/code-review-skill/blob/main/reference/code-review-best-practices.md).

## Author anti-patterns (flag in the change set)

- **Mega PR** — huge unrelated diffs; ask to split
- **No context** — missing why / how to test
- **Silent drive-bys** — unrelated refactors mixed into a feature
- **Commented-out dead code** left behind without reason
- **Gold-plating** — scope beyond the stated problem

## Reviewer anti-patterns (avoid while reviewing)

- Rubber stamping without reading
- Bike-shedding formatting/naming for pages
- Scope creep ("while you're here…") as 🔴
- Perfectionism blocking on 🟢 nits
- Blocking on personal preference when two approaches are valid

## Prioritization (must match labels)

| Priority | Examples |
|----------|----------|
| Must fix 🔴 | Security, data corruption, broken UX, missing critical error handling |
| Should fix 🟡 | Coverage gaps, duplication, unclear structure |
| Nice 🟢 | Minor opts, optional docs, pure style |

## Severity when reviewing the PR itself

- 🟡 Unreviewable mega-diff or missing test plan
- 🟢 Suggest splitting or adding context
