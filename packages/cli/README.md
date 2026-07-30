# DevTree CLI (`devtree-ai`)

Companion CLI that **downloads and installs** the [DevTree](https://github.com/Naughty-Otters/DevTree) desktop app from GitHub Releases (not just a launcher script).

```bash
npm i -g devtree-ai@latest
devtree install          # download macOS DMG / Windows setup for this machine
devtree open             # launch
devtree doctor
```

One-liner (CLI + desktop):

```bash
curl -fsSL https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/install/install.sh | bash
```

Also available via Homebrew cask after the tap is published: `brew install --cask devtree`.
