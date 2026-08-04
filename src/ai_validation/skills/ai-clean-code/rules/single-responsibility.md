# Single Responsibility

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — classes and cohesion.

## Check
- A module/class/file has one reason to change (Single Responsibility Principle)
- Class name reflects its responsibility; `Processor`/`Manager`/`Super` often signals a grab-bag
- Changed units do not mix UI, persistence, and domain policy without clear boundaries
- Avoid “god” types accumulating unrelated methods in the diff
- Maintain high cohesion — instance variables used together by the methods that need them
- Multiple small focused types preferred over one large type in new code
- Prefer composition over deep inheritance when the change adds behavior

## Severity
- blocking: new mixed-responsibility APIs that will be hard to test or evolve
- important: clear SRP violations introduced or expanded by the change
- nit: mild cohesion issues with an obvious split
