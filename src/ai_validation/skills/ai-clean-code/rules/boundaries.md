# Boundaries

## Check
- Third-party/API boundaries are wrapped or isolated when the change depends on them
- Untrusted input validated at the edge (UI → backend, file/network input)
- Avoid leaking vendor types deep into domain code in new code
- Clear ownership of data crossing module boundaries

## Severity
- blocking: untrusted input crossing a trust boundary without checks
- important: tight coupling to vendor types across layers in the diff
- nit: optional adapters that would clarify the boundary
