
# N+1 Queries / Fetches

Apply when loops perform DB, filesystem, network, or IPC work per item.

## Check

- Query/fetch/read inside `for`/`map` over collections
- Per-file analysis that could be batched
- Repeated Tauri `invoke` for each row instead of one bulk command
- Graph walks that re-resolve the same path/package repeatedly (cache/memoize)

## Prefer

```typescript
// ❌ N+1
for (const id of ids) await loadOne(id);

// ✅ Batch
await loadMany(ids);
```

```rust
// ✅ Build an index once, then O(1) lookups in the loop
```

## Severity

- 🔴 Scales with project size and will tank analysis UX
- 🟡 Extra I/O on medium projects
- 🟢 Minor duplicate lookups
