# Open source readiness checklist

This document tracks DevTree's readiness for public open-source distribution.

## License & governance

| Item | Status |
|------|--------|
| [MIT License](LICENSE) | Done |
| [Contributing guide](CONTRIBUTING.md) | Done |
| [Security policy](SECURITY.md) | Done |
| Code of Conduct | Optional — add if accepting external contributors at scale |

## Documentation

| Item | Status |
|------|--------|
| [README](README.md) with setup, build, and test instructions | Done |
| Prerequisites documented (Rust, Node, wasm-pack, Tauri) | Done |
| Architecture / project layout overview | Partial — README covers layout; expand as features stabilize |

## Engineering hygiene

| Item | Status |
|------|--------|
| `.gitignore` for build artifacts, `target/`, `node_modules/`, secrets | Done |
| CI workflow (tests + macOS/Windows builds) | Done — [.github/workflows/ci.yml](.github/workflows/ci.yml) |
| Release workflow (tag → GitHub Release artifacts) | Done — [.github/workflows/release.yml](.github/workflows/release.yml) |
| Rust unit tests (`cargo test --workspace`) | Done |
| TypeScript unit tests (`npm test`) | Done |
| No committed secrets / API keys in repo | Verify before publish — use `.env.example` if needed |

## Distribution

| Item | Status |
|------|--------|
| macOS builds (Apple Silicon + Intel) | CI + release matrix |
| Windows builds (x64) | CI + release matrix |
| Linux builds | Not in release matrix yet — add if needed |
| CI / release code signing | Explicitly disabled (`--no-sign`, `APPLE_SIGNING_IDENTITY=-`, `CSC_IDENTITY_AUTO_DISCOVERY=false`) — same pattern as unsigned staging in OpenFDE CI |
| Signed / notarized macOS binaries | Not automated — add `APPLE_*` secrets to `release.yml` when ready |
| Windows code signing | Not automated — optional for OSS |

## Before first public release

1. Replace placeholder `authors` in `src-tauri/Cargo.toml` with real names or org.
2. Set GitHub repository URL in `package.json` / README badge once published.
3. Run `npm run test:all` and `npm run tauri build` on a clean machine.
4. Tag `v0.1.0` (or current version) to trigger the release workflow; review the draft release assets.
5. Audit dependencies: `cargo audit`, `npm audit` (optional but recommended).

## Known limitations for contributors

- LLM validation rules require user API keys; CI does not run live LLM calls.
- Some Rust integration tests are marked `#[ignore]` and are intended for local scripts only.
- WASM bindings are generated at build time and are gitignored under `src/wasm/`.
