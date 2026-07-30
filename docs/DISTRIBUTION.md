# CLI & package distribution

How DevTree is installed, mirroring the [Teralexi](https://github.com/Naughty-Otters/Teralexi) npm + Homebrew pattern.

```bash
npm i -g devtree-ai@latest
devtree doctor
devtree open

brew tap Naughty-Otters/tap
brew install --cask devtree
```

Or download macOS / Windows installers from [GitHub Releases](https://github.com/Naughty-Otters/DevTree/releases).

## Packages in this repo

| Path | Role |
| --- | --- |
| `packages/cli` | npm package **`devtree-ai`**, bin `devtree` |
| `packaging/homebrew/devtree.rb` | Homebrew **cask** (desktop `.app` via DMG) |

## Release automation

| # | Item | How it’s done |
| --- | --- | --- |
| 1 | Sync versions (root → CLI / cask / Tauri) | `npm run sync:version` · CI `--check` |
| 2 | Publish `devtree-ai` to npm | `release.yml` → `npm-publish-cli` (needs `NPM_TOKEN`) |
| 3 | Fill Homebrew cask sha256 from mac DMG | `release.yml` mac job → `node scripts/update-homebrew-cask.mjs` |
| 4 | Push cask to tap (optional) | `release.yml` → `homebrew-tap` when `HOMEBREW_TAP_TOKEN` is set |
| 5 | GitHub Release assets | `tauri-action` (DMG / MSI / NSIS) |

Secrets:

- `NPM_TOKEN` — publish `devtree-ai` (skipped with a warning if unset)
- `HOMEBREW_TAP_TOKEN` — PAT with write access to `Naughty-Otters/homebrew-tap` (optional; cask artifact is always uploaded)

Local dry-run:

```bash
npm run sync:version -- --check
npm --prefix packages/cli test
npm --prefix packages/cli pack --dry-run
```
