# DevTree

[![CI](https://github.com/devtree/devtree/actions/workflows/ci.yml/badge.svg)](https://github.com/devtree/devtree/actions/workflows/ci.yml)

DevTree is a desktop tool for visualizing a codebase's module/dependency graph and scoring its architectural health — modularity, cleanliness, type coverage, and test coverage. The client is a [Tauri](https://tauri.app/) app; heavy computation (graph layout, metrics) is written in Rust and compiled to WebAssembly so it runs inside the webview, and the graph itself is rendered on an HTML5 Canvas.

**License:** [MIT](LICENSE) · **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) · **Open source checklist:** [OPEN_SOURCE.md](OPEN_SOURCE.md)

**Current status**: desktop analysis builds a package → file → symbol dependency map. Symbol extraction and the **Language Diagnostics** rule use system language servers when available (`rust-analyzer`, `typescript-language-server` / `vtsls`, `gopls`, `basedpyright` / `pyright` / `pylsp`); otherwise heuristics are used.

## Prerequisites

- **Rust** (stable toolchain) with the `wasm32-unknown-unknown` target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Node.js** (v20+) and npm
- **wasm-pack** (v0.13+; older versions are incompatible with recent Cargo — see Troubleshooting below):
  ```bash
  cargo install wasm-pack
  ```
- Tauri's own OS-level dependencies (Xcode Command Line Tools on macOS; see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for Linux/Windows)
- **Optional language servers** (for richer analysis validations and symbol graphs):
  ```bash
  rustup component add rust-analyzer
  npm install -g typescript-language-server typescript   # or: npm i -g @vtsls/language-server
  go install golang.org/x/tools/gopls@latest
  npm install -g basedpyright   # or: pip install basedpyright / python-lsp-server
  ```

## Setup

```bash
npm install
```

This installs frontend dependencies (Vite, TypeScript, the Tauri CLI). Rust dependencies are resolved automatically on first build.

## Running the app

```bash
npm run tauri dev
```

This builds the `devtree-core` crate to wasm, starts the Vite dev server, compiles the Rust backend, and opens the native app window. First run compiles Tauri's full dependency tree and can take several minutes; subsequent runs are fast.

For faster frontend-only iteration (no native window, just the webview content in a regular browser):

```bash
npm run dev
```

then open the printed `http://localhost:1420` URL.

## Testing

```bash
# Rust unit tests (workspace)
npm run test:rust

# TypeScript unit tests (Vitest)
npm test

# Both
npm run test:all
```

CI runs tests and builds macOS (Apple Silicon) and Windows on every push to `main`, then uploads installers as **GitHub Actions artifacts** (GitHub only — no other stores).

## Releasing

Distribution is **GitHub Releases only**. Push a version tag to create a draft release with platform binaries; publish the draft on GitHub so users can download:

```bash
git tag v0.1.0
git push origin v0.1.0
```

See [.github/workflows/release.yml](.github/workflows/release.yml).

## Building

```bash
npm run tauri build
```

## Project layout

```
DevTree/
├── crates/devtree-core/   # Graph types + force-directed layout, plain Rust
│                          # compiled natively (linked into src-tauri) and to
│                          # wasm32 (via `npm run build:wasm`) for the frontend
├── src-tauri/             # Tauri Rust backend (app shell; no real commands yet)
├── src/                   # Vite + TypeScript frontend
│   ├── canvas/            # Canvas renderer + pan/zoom/hover/click interaction
│   ├── graph/             # Graph types + fixture loading
│   └── wasm-bridge.ts     # Typed wrapper around the generated wasm module
└── fixtures/               # Canned graph data used until real analysis exists
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server only (browser, no Tauri window) |
| `npm run build:wasm` | Rebuild `devtree-core` to wasm and copy bindings into `src/wasm` |
| `npm run build` | Type-check and build the frontend |
| `npm run test` | Run TypeScript unit tests (Vitest) |
| `npm run test:rust` | Run Rust unit tests |
| `npm run test:all` | Run Rust + TypeScript tests |
| `npm run tauri dev` | Run the full Tauri app (rebuilds wasm automatically via `predev`) |
| `npm run tauri build` | Build a distributable native app |

`build:wasm` runs automatically before `dev`/`build` via `predev`/`prebuild` hooks, so you generally don't need to call it directly.

## Troubleshooting

- **`the --artifact-dir flag is unstable` error from `wasm-pack build`**: your `wasm-pack` is too old for the installed Cargo version. Run `cargo install wasm-pack --force` to upgrade (this project has been verified against wasm-pack 0.15.0 with Cargo 1.93).
- **Stale build errors mentioning a path that no longer exists** (e.g. after moving/renaming this directory): Rust caches absolute paths in `target/`. Delete it and rebuild: `rm -rf target && cargo build --workspace`.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
