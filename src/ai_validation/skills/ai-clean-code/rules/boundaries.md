# Boundaries

Based on [Clean Code Cheat Sheet](https://www.softensity.com/blog/clean-code-cheat-sheet/) — boundaries and adapters.

## Check
- Wrap third-party APIs and external systems — expose limited capability locally
- Use adapter pattern when integrating foreign behavior; only the adapter changes when APIs shift
- Untrusted input validated at the edge (UI → backend, file/network input)
- Avoid leaking vendor types deep into domain code in new code
- Clear ownership of data crossing module boundaries
- Map foreign errors to project standards at integration points

## Severity
- blocking: untrusted input crossing a trust boundary without checks
- important: tight coupling to vendor types across layers in the diff
- nit: optional adapters that would clarify the boundary
