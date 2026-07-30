
# SQL Injection Prevention

Apply when code builds SQL, touches SQLite/DB helpers, or concatenates query fragments.

## Rules

- Never interpolate user/project input into SQL strings
- Use bound parameters / prepared statements
- Allowlist dynamic identifiers (table/column names) — parameters cannot bind identifiers
- Treat frontend-provided filters/sort keys as untrusted
- Prefer existing DB helpers over ad-hoc SQL

## Examples

```rust
// ❌ BAD
let q = format!("SELECT * FROM files WHERE path = '{path}'");

// ✅ GOOD
// sqlx::query("SELECT * FROM files WHERE path = ?").bind(path)
```

## Severity

- 🔴 Any user-influenced string concatenation into SQL
- 🟡 Internal-only concatenation without allowlist
- 🟢 Style of query organization
