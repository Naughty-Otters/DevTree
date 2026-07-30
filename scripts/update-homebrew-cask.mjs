#!/usr/bin/env node
/**
 * Refresh packaging/homebrew/devtree.rb with sha256 of the macOS arm64 DMG.
 *
 * Usage:
 *   node scripts/update-homebrew-cask.mjs
 *   node scripts/update-homebrew-cask.mjs --dmg path/to/devtree_0.1.0_aarch64.dmg
 *   node scripts/update-homebrew-cask.mjs --bundle-dir src-tauri/target/aarch64-apple-darwin/release/bundle
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function findDmg(bundleDir) {
  const dmgDir = join(bundleDir, "dmg");
  if (!existsSync(dmgDir)) return null;
  const names = readdirSync(dmgDir).filter((n) => n.endsWith(".dmg"));
  const preferred = names.find((n) => n.includes(version) && /aarch64|arm64/i.test(n));
  const any = preferred ?? names.find((n) => /aarch64|arm64/i.test(n)) ?? names[0];
  return any ? join(dmgDir, any) : null;
}

const explicitDmg = argValue("--dmg");
const bundleDir =
  argValue("--bundle-dir") ||
  join(root, "src-tauri", "target", "aarch64-apple-darwin", "release", "bundle");

const dmgPath = explicitDmg || findDmg(bundleDir);
if (!dmgPath || !existsSync(dmgPath)) {
  console.error(
    `[homebrew-cask] Missing macOS DMG.\n` +
      `  looked for: ${explicitDmg || join(bundleDir, "dmg", "*.dmg")}\n` +
      `Pass --dmg <path> after a Tauri macOS build.`,
  );
  process.exit(1);
}

const hash = sha256File(dmgPath);
const assetName = `devtree_${version}_aarch64.dmg`;
const url = `https://github.com/Naughty-Otters/DevTree/releases/download/v#{version}/${assetName}`;

const cask = `# typed: false
# Homebrew Cask for the DevTree desktop app.
# Copy into Naughty-Otters/homebrew-tap Casks/devtree.rb after each release.
# sha256 values are written by the release pipeline:
#   node scripts/update-homebrew-cask.mjs
#
#   brew tap Naughty-Otters/tap
#   brew install --cask devtree

cask "devtree" do
  version "${version}"
  desc "Desktop codebase dependency graph and architecture validation"
  homepage "https://github.com/Naughty-Otters/DevTree"

  livecheck do
    url :url
    strategy :github_latest
  end

  on_arm do
    url "https://github.com/Naughty-Otters/DevTree/releases/download/v#{version}/${assetName}"
    sha256 "${hash}"
  end

  app "devtree.app"

  zap trash: [
    "~/Library/Application Support/com.devtree.app",
    "~/Library/Caches/com.devtree.app",
    "~/Library/Preferences/com.devtree.app.plist",
    "~/Library/WebKit/com.devtree.app",
  ]
end
`;

const outPath = join(root, "packaging", "homebrew", "devtree.rb");
writeFileSync(outPath, cask, "utf8");

const checksumPath = join(root, "packaging", "homebrew", "devtree-cask-checksums.json");
writeFileSync(
  checksumPath,
  `${JSON.stringify(
    {
      version,
      generatedAt: new Date().toISOString(),
      files: { [assetName]: hash },
      source: dmgPath,
      urlTemplate: url,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`${dmgPath}  ${hash}`);
console.log(`[homebrew-cask] Updated ${outPath}`);
console.log(`[homebrew-cask] Wrote ${checksumPath}`);
