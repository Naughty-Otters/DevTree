# Classes & Data Structures

## Check
- Prefer clear data vs object separation (avoid hybrid “half-object” bags)
- Hide internals; expose intention-revealing operations
- Avoid train wrecks / law-of-Demeter violations in new code (`a.getB().getC()`)
- Keep classes small; instance variables should be cohesively used

## Severity
- blocking: new leaky abstractions that expose internals and invite misuse
- important: sprawling types or Demeter chains introduced in the change
- nit: mild cohesion improvements
