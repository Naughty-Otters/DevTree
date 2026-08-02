#!/usr/bin/env node
/**
 * Bump the DevTree release version and sync all release-facing manifests.
 *
 * Updates root package.json, then runs scripts/sync-cli-version.mjs so CLI,
 * Homebrew cask, Tauri config, and src-tauri Cargo.toml stay aligned.
 * Also bumps package-lock.json (root) and crates/devtree-core/Cargo.toml.
 *
 * Usage:
 *   npm run version:bump -- patch
 *   npm run version:bump -- minor
 *   npm run version:bump -- major
 *   npm run version:bump -- 0.2.0
 *   node scripts/bump-version.mjs patch --dry-run
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const bumpArg = args.find((a) => a !== "--dry-run");

if (!bumpArg || bumpArg === "--help" || bumpArg === "-h") {
  console.log(`Usage:
  npm run version:bump -- <patch|minor|major|x.y.z> [--dry-run]

Examples:
  npm run version:bump -- patch
  npm run version:bump -- 0.2.0
`);
  process.exit(bumpArg ? 0 : 1);
}

/**
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, pre: string }}
 */
function parseSemver(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: "",
  };
}

/**
 * @param {string} current
 * @param {string} bump
 */
function nextVersion(current, bump) {
  const explicit = bump.replace(/^v/, "");
  if (/^\d+\.\d+\.\d+([.-].*)?$/.test(explicit)) {
    parseSemver(explicit); // validate
    return explicit;
  }

  const { major, minor, patch } = parseSemver(current);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(
        `Unknown bump '${bump}'. Use patch, minor, major, or an explicit x.y.z version.`,
      );
  }
}

/**
 * @param {string} path
 * @param {(text: string) => string} transform
 */
function updateTextFile(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (before === after) return false;
  if (!dryRun) writeFileSync(path, after, "utf8");
  return true;
}

const rootPkgPath = join(root, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const current = String(rootPkg.version ?? "").trim();
if (!current) {
  console.error("Root package.json version is missing");
  process.exit(1);
}

let next;
try {
  next = nextVersion(current, bumpArg);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

if (next === current) {
  console.log(`Version already ${current}; nothing to bump.`);
  process.exit(0);
}

console.log(`${dryRun ? "[dry-run] " : ""}${current} → ${next}`);

if (!dryRun) {
  rootPkg.version = next;
  writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`, "utf8");
  console.log(`Updated package.json`);
} else {
  console.log(`Would update package.json`);
}

const lockPath = join(root, "package-lock.json");
const lockChanged = updateTextFile(lockPath, (text) => {
  const lock = JSON.parse(text);
  lock.version = next;
  if (lock.packages?.[""]) {
    lock.packages[""].version = next;
  }
  return `${JSON.stringify(lock, null, 2)}\n`;
});
console.log(
  lockChanged
    ? `${dryRun ? "Would update" : "Updated"} package-lock.json`
    : "OK  package-lock.json (unchanged)",
);

const coreCargoPath = join(root, "crates", "devtree-core", "Cargo.toml");
const coreChanged = updateTextFile(coreCargoPath, (text) =>
  text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`),
);
console.log(
  coreChanged
    ? `${dryRun ? "Would update" : "Updated"} crates/devtree-core/Cargo.toml`
    : "OK  crates/devtree-core/Cargo.toml (unchanged)",
);

if (dryRun) {
  console.log("Dry run only — skipped sync:version");
  process.exit(0);
}

const sync = spawnSync(process.execPath, [join(root, "scripts", "sync-cli-version.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (sync.status !== 0) {
  process.exit(sync.status ?? 1);
}

console.log(`\nBumped to ${next}. Next steps:
  1. Review the diff, then commit
  2. Tag and release: git tag v${next} && git push origin v${next}
     (or Actions → Release → Run workflow)`);
