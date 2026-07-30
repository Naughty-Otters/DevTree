
# Logging Strategy

## Levels

| Level | Use for |
|-------|---------|
| ERROR | Needs attention (failed analysis, invariant broken) |
| WARN | Recoverable (retry, fallback, skipped path) |
| INFO | Milestone events (analysis started/finished, schedule fired) |
| DEBUG | Verbose internals (off by default in production) |

## Rules

- Prefer structured context (path, phase, counts) over string blobs
- Never log secrets, API keys, tokens, or raw PII
- Don't log entire file contents or huge DSM matrices at INFO
- Avoid `println!`/`dbg!`/`console.log` left in hot paths for production features
- Errors: log at the boundary OR propagate — not both everywhere
- User-facing errors should be clear in UI; logs are for diagnosis

## Examples

```rust
// ❌ log!("key={}", api_key);
// ✅ tracing::warn!(?path, error = %e, "watch skipped path");
```

```typescript
// ❌ console.log(options.apiKey)
// ✅ console.warn("analysis failed", { projectPath, phase })
```

## Severity

- 🔴 Secrets/PII in logs
- 🟡 Useless noise or missing context on failures
- 🟢 Level tweaks / structured-field polish
