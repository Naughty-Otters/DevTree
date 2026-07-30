
# Security Review

Use for Tauri commands, agent tools, shell, filesystem, network, and settings that hold secrets.

## Check

- Command injection in shell tools (no unsanitized string concatenation into shells)
- Path traversal / escape outside project root
- Trust boundary: frontend → Tauri command inputs are untrusted
- Secrets (API keys) never logged, committed, or sent to unintended hosts
- SSRF / open redirects if URLs are user-controlled
- Dangerous `unsafe` in Rust without justification
- Overly broad file read/write scopes
- Deserialization of untrusted data without validation

## Severity hints

- 🔴 Exploitable injection, secret leak, arbitrary file/command execution
- 🟡 Missing validation that could become exploitable
- 🟢 Hardening / defense-in-depth

## Prefer

```rust
// ✅ Allowlist operations; reject `..` and absolute paths escaping root
// ✅ Pass argv arrays, never `sh -c` with interpolated user strings
```

Also run `review-sql-injection` and `review-xss` when those surfaces appear.
