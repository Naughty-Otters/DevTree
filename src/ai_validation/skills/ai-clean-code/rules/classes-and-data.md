# Classes & Data Structures

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — objects and data structures.

## Check
- Data structures expose data with minimal behavior; objects hide data and expose behavior
- Avoid hybrid “half-object, half-data” bags in new types
- Hide internal structure; expose intention-revealing operations
- Avoid train wrecks / Law of Demeter violations (`a.getB().getC().doD()`)
- Keep classes small; few instance variables, all used cohesively by methods
- Base types should not know details of derivatives
- Prefer many small functions over passing behavior-selecting code into one function
- Prefer non-static methods when instance state matters; static only when truly stateless

## Severity
- blocking: new leaky abstractions that expose internals and invite misuse
- important: sprawling types or Demeter chains introduced in the change
- nit: mild cohesion or data/object separation improvements
