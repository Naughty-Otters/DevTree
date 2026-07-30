# Single Responsibility

## Check
- A module/class/file has one reason to change
- Changed units do not mix UI, persistence, and domain policy without clear boundaries
- Avoid “god” types accumulating unrelated methods in the diff
- Prefer cohesive packages/modules over dumping unrelated helpers together

## Severity
- blocking: new mixed-responsibility APIs that will be hard to test or evolve
- important: clear SRP violations introduced or expanded by the change
- nit: mild cohesion issues with an obvious split
