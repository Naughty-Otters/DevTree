# CLI & package distribution

How DevTree is installed, mirroring the [Teralexi](https://github.com/Naughty-Otters/Teralexi) npm + Homebrew pattern — the npm package **downloads and installs** the desktop app from GitHub Releases.

```bash
# One-liner (npm CLI + desktop)
curl -fsSL https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/install/install.sh | bash

npm i -g devtree-ai@latest
devtree install                 # download + install desktop for this machine
devtree open

brew tap Naughty-Otters/tap && brew install --cask devtree
```

## Packages in this repo

| Path | Role |
| --- | --- |
| `packages/cli` | npm package **`devtree-ai`**, bin `devtree` (`install` / `open` / `doctor`) |
| `install/install.sh` | curl\|bash installer (CLI via npm + desktop via `devtree install`) |
| `packaging/homebrew/devtree.rb` | Homebrew **cask** (desktop `.app` via DMG) |

## What `devtree install` does

1. Resolves `v{cli-version}` (or `--version` / latest) on GitHub Releases
2. Picks the best asset for this OS/arch (`.app.tar.gz` / `.dmg` on macOS, `-setup.exe` / `.msi` on Windows)
3. Downloads it, installs to `/Applications` or `~/Applications` (macOS) or runs the Windows installer
4. Records the path in `~/.devtree/install.json` for `devtree open` / `doctor`

## Release automation

| # | Item | How it’s done |
| --- | --- | --- |
| 1 | Sync versions (root → CLI / cask / Tauri) | `npm run sync:version` · CI `--check` |
| 2 | Publish `devtree-ai` to npm | `release.yml` → `npm-publish-cli` (needs `NPM_TOKEN`) |
| 3 | Fill Homebrew cask sha256 from mac DMG | `release.yml` mac job → `node scripts/update-homebrew-cask.mjs` |
| 4 | Push cask to tap (optional) | `release.yml` → `homebrew-tap` when `HOMEBREW_TAP_TOKEN` is set |
| 5 | GitHub Release assets | `tauri-action` (DMG / MSI / NSIS) — required for `devtree install` |
| 6 | GitHub Actions artifacts | Same installers uploaded on the Release workflow run (`DevTree-vX.Y.Z-<target>`, 90-day retention) |
| 7 | Manual release | Actions → **Release** → **Run workflow** (or `gh workflow run Release -f version=0.1.0`) |

Secrets (repo or GitHub Environment **`release`** — same names as [OpenFDE](https://github.com/Naughty-Otters/OpenFDE)):

| Secret | Used for |
| --- | --- |
| `MAC_SIGN_CERTIFICATE_BASE64` | Base64 `.p12` (Developer ID Application) → Tauri `APPLE_CERTIFICATE` |
| `MAC_SIGN_CERTIFICATE_PASSWORD` | `.p12` password → `APPLE_CERTIFICATE_PASSWORD` |
| `MAC_SIGN_IDENTITY` | Optional (OpenFDE/electron short name). Tauri resolves the full identity from the `.p12` |
| `MAC_APPLE_ID` | Apple ID email → `APPLE_ID` (must own the Developer team) |
| `MAC_APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from [appleid.apple.com](https://appleid.apple.com) → Tauri `APPLE_PASSWORD` (not your Apple ID login password) |
| `MAC_APPLE_TEAM_ID` | 10-char Team ID → `APPLE_TEAM_ID` |
| `WIN_SIGN_CERTIFICATE_BASE64` | Base64 `.pfx` (fallback if Azure not set) |
| `WIN_SIGN_CERTIFICATE_PASSWORD` | `.pfx` password |
| `AZURE_TENANT_ID` | Entra tenant ID (Azure Trusted Signing — preferred) |
| `AZURE_CLIENT_ID` | App registration client ID |
| `AZURE_CLIENT_SECRET` | App registration client secret |
| `AZURE_SIGNING_ENDPOINT` | Artifact Signing account URI (e.g. `https://eus.codesigning.azure.net/`) |
| `AZURE_SIGNING_ACCOUNT_NAME` | Artifact Signing account name |
| `AZURE_SIGNING_CERTIFICATE_PROFILE` | Certificate profile name |
| `AZURE_SIGNING_PUBLISHER_NAME` | Publisher / legal name (UAC description) |
| `NPM_TOKEN` | publish `devtree-ai` (skipped with a warning if unset) |
| `HOMEBREW_TAP_TOKEN` | PAT with write access to `Naughty-Otters/homebrew-tap` (optional) |

Windows signing requires **either** all seven `AZURE_*` vars (preferred, same as OpenFDE) **or** `WIN_SIGN_*`. CI builds stay unsigned (`--no-sign`). Only the **Release** workflow signs (and notarizes on macOS).

Local dry-run:

```bash
npm run sync:version -- --check
npm --prefix packages/cli test
(cd packages/cli && npm pack --dry-run)
```
