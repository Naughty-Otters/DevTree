# DevTree

DevTree is a desktop tool for visualizing a codebase's module/dependency graph and (eventually) scoring its architectural health — modularity, cleanliness, type coverage, and test coverage. The client is a [Tauri](https://tauri.app/) app; heavy computation (graph layout, metrics) is written in Rust and compiled to WebAssembly so it runs inside the webview, and the graph itself is rendered on an HTML5 Canvas.

**Current status**: milestone 1 only — a working Tauri shell that renders a hand-authored fixture graph ([fixtures/sample-graph.json](fixtures/sample-graph.json)) on Canvas via a Rust/wasm-computed force-directed layout. There is no real source-code analysis (LSP integration, scoring) yet.

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
| `npm run tauri dev` | Run the full Tauri app (rebuilds wasm automatically via `predev`) |
| `npm run tauri build` | Build a distributable native app |

`build:wasm` runs automatically before `dev`/`build` via `predev`/`prebuild` hooks, so you generally don't need to call it directly.

## Troubleshooting

- **`the --artifact-dir flag is unstable` error from `wasm-pack build`**: your `wasm-pack` is too old for the installed Cargo version. Run `cargo install wasm-pack --force` to upgrade (this project has been verified against wasm-pack 0.15.0 with Cargo 1.93).
- **Stale build errors mentioning a path that no longer exists** (e.g. after moving/renaming this directory): Rust caches absolute paths in `target/`. Delete it and rebuild: `rm -rf target && cargo build --workspace`.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
