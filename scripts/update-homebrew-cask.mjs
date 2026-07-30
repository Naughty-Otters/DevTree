#!/usr/bin/env node
/**
 * Refresh packaging/homebrew/devtree.rb with sha256 of the macOS arm64 installer.
 *
 * Usage:
 *   node scripts/update-homebrew-cask.mjs
 *   node scripts/update-homebrew-cask.mjs --dmg path/to/devtree_0.1.0_aarch64.dmg
 *   node scripts/update-homebrew-cask.mjs --bundle-dir src-tauri/target/aarch64-apple-darwin/release/bundle
 *   node scripts/update-homebrew-cask.mjs --search-root src-tauri/target
 *   node scripts/update-homebrew-cask.mjs --allow-missing   # warn + exit 0 (CI soft-fail)
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const allowMissing = process.argv.includes("--allow-missing");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip huge unrelated trees.
      if (name === "deps" || name === "build" || name === ".fingerprint") continue;
      walkFiles(path, out);
    } else if (st.isFile()) {
      out.push(path);
    }
  }
  return out;
}

function scoreInstaller(path) {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  const lower = name.toLowerCase();
  let score = 0;
  if (lower.endsWith(".dmg")) score += 100;
  else if (lower.endsWith(".app.tar.gz")) score += 80;
  else return -1;

  if (lower.includes(version)) score += 20;
  if (/aarch64|arm64/.test(lower)) score += 15;
  if (lower.startsWith("devtree")) score += 10;
  // Prefer target-triple builds when both host + triple exist.
  if (path.includes(`${join("aarch64-apple-darwin", "release")}`)) score += 5;
  return score;
}

function findInstaller(searchRoots) {
  const candidates = [];
  for (const dir of searchRoots) {
    for (const file of walkFiles(dir)) {
      const score = scoreInstaller(file);
      if (score >= 0) candidates.push({ file, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.file ?? null;
}

const explicitDmg = argValue("--dmg");
const bundleDir = argValue("--bundle-dir");
const searchRoot =
  argValue("--search-root") || join(root, "src-tauri", "target");

const searchRoots = [];
if (bundleDir) {
  searchRoots.push(bundleDir);
  searchRoots.push(join(bundleDir, "dmg"));
  searchRoots.push(join(bundleDir, "macos"));
}
searchRoots.push(searchRoot);
searchRoots.push(join(root, "src-tauri", "target", "aarch64-apple-darwin", "release", "bundle"));
searchRoots.push(join(root, "src-tauri", "target", "release", "bundle"));

const installerPath = explicitDmg || findInstaller(searchRoots);
if (!installerPath || !existsSync(installerPath)) {
  const msg =
    `[homebrew-cask] Missing macOS installer (.dmg or .app.tar.gz).\n` +
    `  searched: ${searchRoots.map((p) => relative(root, p) || p).join(", ")}\n` +
    `Pass --dmg <path> after a Tauri macOS build.`;
  if (allowMissing) {
    console.warn(msg);
    console.warn("[homebrew-cask] --allow-missing set; skipping cask update.");
    process.exit(0);
  }
  console.error(msg);
  process.exit(1);
}

const hash = sha256File(installerPath);
const baseName = installerPath.replace(/\\/g, "/").split("/").pop();
const isDmg = /\.dmg$/i.test(baseName);
const assetName = isDmg
  ? `devtree_${version}_aarch64.dmg`
  : `devtree.app.tar.gz`;
const downloadUrl = `https://github.com/Naughty-Otters/DevTree/releases/download/v#{version}/${assetName}`;

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
    url "${downloadUrl}"
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
      source: installerPath,
      sourceBaseName: baseName,
      urlTemplate: downloadUrl,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`${installerPath}  ${hash}`);
console.log(`[homebrew-cask] Using ${baseName} → release asset name ${assetName}`);
console.log(`[homebrew-cask] Updated ${outPath}`);
console.log(`[homebrew-cask] Wrote ${checksumPath}`);
