# Design Rules

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — design principles.

## Check
- Keep configurable data (constants, thresholds, feature flags) at high levels and easy to change
- Prefer polymorphism or strategy objects over growing if/else or switch/case chains in new code
- Use dependency injection for external services — avoid hard-coded singletons in changed modules
- Law of Demeter: a unit should talk to its direct collaborators, not chains of strangers
- Separate multi-threading/concurrency code from business logic when the change touches both
- Prevent over-configurability — avoid knobs that no caller will ever need
- Single Responsibility: each module/class should have one reason to change

## Severity
- blocking: new tight coupling or Law-of-Demeter chains that hide dependencies
- important: switch/if pyramids or missing DI that will block testing or extension
- nit: clearer placement of constants or mild polymorphism opportunities
