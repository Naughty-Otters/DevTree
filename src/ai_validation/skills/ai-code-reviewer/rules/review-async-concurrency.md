
# Async & Concurrency

## Check

- Race conditions on shared state (`Mutex`, stores, analysis session flags)
- Cancellation: analysis/watch/cron stop flags actually abort work
- Deadlock risk (lock order, `await` while holding a lock)
- Fire-and-forget promises/tasks without error supervision
- Double-start of watchers/schedulers without stopping the previous run
- TS: stale async results applying after newer runs (use generation tokens / AbortSignal)
- Rust: `Send`/`Sync` bounds, blocking inside async runtimes

## Prefer

```typescript
// ✅ Ignore stale results
const gen = ++runId;
const result = await analyze();
if (gen !== runId) return;
```

```rust
// ✅ Check AtomicBool / cancel token between expensive phases
```

## Severity

- 🔴 Data corruption, deadlock, or uncancellable runaway work
- 🟡 Benign races causing flicker/incorrect transient UI
- 🟢 Clarity / structured-concurrency style
