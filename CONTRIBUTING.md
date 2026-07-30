# Contributing to DevTree

Thank you for your interest in contributing!

## Development setup

1. Install [prerequisites](README.md#prerequisites) (Rust, Node.js 20+, wasm-pack, Tauri system deps).
2. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
   This also installs Git hooks (via Husky):
   - **pre-commit** — full test suite (`test:all`: per-file checks, Rust, TypeScript + coverage)
   - **pre-push** — same full suite (`test:all`)
3. Run the desktop app:
   ```bash
   npm run tauri dev
   ```

## Tests

Run the full test suite before opening a pull request:

```bash
npm run test:all
```

- **Coverage:** `npm run test:coverage` — core logic modules must meet **≥80%** line/statement/function coverage (branches ≥65%); UI/integration layers use per-file smoke tests
- **Rust:** `cargo test --workspace`
- **TypeScript:** `npm test` (Vitest)

`git commit` and `git push` both run the full suite via Husky (`npm run test:all`).

Run the same checks manually: `npm run precommit` or `npm run test:all`

CI runs the same checks on every push and pull request.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Keep changes focused; include tests when fixing bugs or adding behavior.
3. Ensure `npm run test:all` and `npm run build` pass locally.
4. Open a pull request with a clear description of the problem and solution.

## Code style

- **Rust:** follow existing module layout; run `cargo fmt` before committing.
- **TypeScript:** strict mode is enabled; match surrounding naming and import style.

## Reporting issues

Please include your OS, DevTree version, and steps to reproduce. For crashes, attach relevant logs from the terminal running `npm run tauri dev`.
