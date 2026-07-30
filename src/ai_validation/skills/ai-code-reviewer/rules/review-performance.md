
# Performance Review

Use when reviewing hot paths, graph/DSM analysis, canvas rendering, or large data transforms.

## Check

- Algorithmic complexity on project-sized inputs (files, edges, DSM matrix)
- Unnecessary O(n²) nested loops; prefer maps/sets for lookups
- Extra allocations / clones in Rust hot loops (`clone()`, `to_string()` in inner loops)
- Repeated DOM work or full re-renders where incremental update suffices
- Blocking work on the UI/main thread; move heavy analysis off-thread when needed
- Missing debounce/throttle on watchers, scroll, resize, search
- N+1 style I/O (also apply `review-n-plus-one`)

## Severity hints

- 🔴 Pathological complexity or UI freeze on realistic projects
- 🟡 Clear waste on large inputs without a measured cliff
- 🟢 Micro-opts without evidence

## Prefer

```rust
// ✅ Index once
let by_id: HashMap<_, _> = nodes.iter().map(|n| (n.id, n)).collect();
```

```typescript
// ❌ BAD: rebuild heavy structure every frame
// ✅ GOOD: recompute only when analysis result identity changes
```
