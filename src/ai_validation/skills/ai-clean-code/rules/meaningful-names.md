# Meaningful Names

## Check
- Names reveal intent (no cryptic abbreviations in new/changed code)
- Avoid disinformation (e.g. `accountList` that is not a list)
- Pronounceable, searchable names; avoid single-letter names except tiny scopes
- Classes/types are nouns; functions/methods are verbs
- No encodings (Hungarian, type prefixes) unless project convention requires them
- Prefer one word per concept; avoid noise words (`data`, `info`, `manager` without meaning)

## Severity
- blocking: names that actively mislead about behavior
- important: unclear names on public APIs or core domain types
- nit: slightly verbose/noisy but understandable
