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

Primary downloads are **GitHub Releases**. Release automation also updates **npm** (`devtree-ai`) and a **Homebrew cask** (same pattern as [Teralexi](https://github.com/Naughty-Otters/Teralexi)). Details: [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

| Item | Status |
|------|--------|
| macOS builds (Apple Silicon) | CI + release matrix |
| Windows builds (x64) | CI + release matrix |
| Linux builds | Not in release matrix yet — add if needed |
| CI uploads | GitHub Actions artifacts |
| Release uploads | GitHub Releases (draft → publish for downloads) |
| npm CLI (`devtree-ai`) | `release.yml` → `npm-publish-cli` when `NPM_TOKEN` is set |
| Homebrew cask (`devtree`) | Cask template + sha256 from mac DMG; tap push when `HOMEBREW_TAP_TOKEN` is set |
| CI code signing | Disabled (`--no-sign`) |
| Release macOS signing + notarization | `release` environment secrets `MAC_SIGN_*` / `MAC_APPLE_*` (same as OpenFDE) → Tauri `APPLE_*` |
| Release Windows signing | Optional `WIN_SIGN_CERTIFICATE_BASE64` + `WIN_SIGN_CERTIFICATE_PASSWORD` |

## Before first public release

1. Replace placeholder `authors` in `src-tauri/Cargo.toml` with real names or org.
2. Repository URL is set in `package.json` / README badges (`Naughty-Otters/DevTree`). CI on `main` refreshes version + coverage badges in `.github/badges/`.
3. Run `npm run test:all` and `npm run tauri build` on a clean machine.
4. Create `Naughty-Otters/homebrew-tap` (if missing) and add repo secrets `NPM_TOKEN` / `HOMEBREW_TAP_TOKEN`.
5. Create a GitHub Environment named **`release`** and add the same `MAC_SIGN_*` / `MAC_APPLE_*` (and optional `WIN_SIGN_*`) secrets used by OpenFDE — see [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).
6. Tag `v0.1.0` (or current version) to trigger the release workflow; review the draft on GitHub, then publish so users can download.
7. Audit dependencies: `cargo audit`, `npm audit` (optional but recommended).

## Known limitations for contributors

- LLM validation rules require user API keys; CI does not run live LLM calls.
- Some Rust integration tests are marked `#[ignore]` and are intended for local scripts only.
- WASM bindings are generated at build time and are gitignored under `src/wasm/`.
