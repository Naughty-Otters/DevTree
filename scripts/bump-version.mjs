#!/usr/bin/env node
/**
 * Bump the single source of truth (`VERSION`), then apply to all manifests.
 *
 * Usage:
 *   npm run version:bump -- patch
 *   npm run version:bump -- minor
 *   npm run version:bump -- major
 *   npm run version:bump -- 0.2.0
 *   node scripts/bump-version.mjs patch --dry-run
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const versionPath = join(root, "VERSION");
const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const bumpArg = args.find((a) => a !== "--dry-run");

if (!bumpArg || bumpArg === "--help" || bumpArg === "-h") {
  console.log(`Usage:
  npm run version:bump -- <patch|minor|major|x.y.z> [--dry-run]

Single source of truth: VERSION
`);
  process.exit(bumpArg ? 0 : 1);
}

function parseSemver(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error(`Invalid semver: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function nextVersion(current, bump) {
  const explicit = bump.replace(/^v/, "");
  if (/^\d+\.\d+\.\d+([.-].*)?$/.test(explicit)) {
    parseSemver(explicit);
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

if (!existsSync(versionPath)) {
  console.error("Missing VERSION file at repo root");
  process.exit(1);
}

const current = readFileSync(versionPath, "utf8").trim().split(/\s+/)[0].replace(/^v/, "");
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

if (dryRun) {
  console.log("Would update VERSION and run sync:version");
  process.exit(0);
}

writeFileSync(versionPath, `${next}\n`, "utf8");
console.log("Updated VERSION");

const sync = spawnSync(process.execPath, [join(root, "scripts", "apply-version.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (sync.status !== 0) {
  process.exit(sync.status ?? 1);
}

console.log(`\nBumped to ${next}. Next steps:
  1. Review the diff, then commit
  2. Publish CLI: npm run publish:cli
  3. Tag and release: git tag v${next} && git push origin v${next}
     (or Actions → Release → Run workflow with version ${next})`);
