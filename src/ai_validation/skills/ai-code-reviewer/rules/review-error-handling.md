
# Error Handling

## Principles

1. Don't swallow errors (empty `catch`, `_ =` ignore, bare `let _ =`)
2. Add context (operation + key ids/paths)
3. Prefer typed/specific errors over generic `Error` / `anyhow!` without context
4. Fail fast on invalid preconditions
5. Handle once at the right layer (avoid log+return+wrap at every level)

## Rust / TS specifics

- Rust: avoid `unwrap`/`expect` in library/production paths; use `?` + contextual maps
- TS: don't use empty `catch`; preserve `cause` when rethrowing
- Surface user-facing failures in UI; don't only `console.error`

## Examples

```rust
// ❌ .unwrap() in analysis command
// ✅ .map_err(|e| format!("failed to build DSM for {path}: {e}"))?
```

```typescript
// ❌ catch { }
// ✅ catch (e) { throw new Error(`analysis failed for ${path}`, { cause: e }); }
```

## Severity

- 🔴 Silent failure / panic on expected errors
- 🟡 Lost context making production debug hard
- 🟢 Slightly clearer messages
