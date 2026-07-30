#!/usr/bin/env node
/** Printed after `npm i -g devtree-ai` — does not download (keeps installs offline-safe). */
console.log(`
devtree-ai installed. Next:

  devtree install   # download & install the desktop app from GitHub Releases
  devtree open      # launch it
  devtree doctor    # verify

Or one-liner: curl -fsSL https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/install/install.sh | bash
`);
