# Meaningful Names

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — naming rules.

## Check
- Names reveal intent — no cryptic abbreviations (`sd`, `chqRetVal`) in new/changed code
- Make meaningful distinctions (`startDate`/`endDate`, not `date1`/`date2`)
- Pronounceable and searchable; avoid single-letter names except tiny loop scopes
- Classes/types/packages are nouns; functions/methods are verbs (`getAccounts`, not `accounts`)
- Replace magic numbers/strings with named constants when meaning matters
- No encodings (Hungarian, type prefixes) unless the project convention requires them
- Avoid noise words (`data`, `info`, `manager`) without clear meaning
- Avoid disinformation (`accountList` that is not a list; `activeUsersArray` when type is obvious)
- Avoid implementation details in names (`fiveAdminUsers` → `adminUsers`)
- One word per concept — align with project (`getUserById` not mixed `find`/`fetch`/`get`)
- Prefer domain terms (`transactionsCache` over `transactionsStorage`)
- Avoid confusing characters (`l`, `I`, `O`) and unpopular acronyms
- Related types follow a common pattern (`UserService`, `UserDAO`, not mixed suffixes)
- Follow project case conventions (camelCase methods, PascalCase types, etc.)

## Severity
- blocking: names that actively mislead about behavior or type
- important: unclear names on public APIs, domain types, or exported symbols
- nit: slightly verbose or noisy but understandable names
