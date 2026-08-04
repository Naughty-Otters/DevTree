# Understandability

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — understandability tips.

## Check
- Be consistent: similar things done the same way within the change and matching project style
- Use explanatory variables for non-obvious expressions and compound conditions
- Encapsulate boundary conditions (edge cases, limits) in one place instead of scattering checks
- Prefer dedicated value objects/types over primitive strings/numbers for domain concepts
- Avoid logical dependency — methods should not rely on implicit call order or hidden class state
- Avoid negative conditionals when a positive form reads clearer (`isActive` vs `isInactive`)
- One word per concept: pick `get`/`fetch`/`find` consistently with the rest of the codebase

## Severity
- blocking: scattered boundary logic that is easy to get wrong or inconsistent
- important: primitives where a value type would prevent misuse; confusing negative logic
- nit: rename to explanatory variable or align naming with nearby code
