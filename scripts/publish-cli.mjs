#!/usr/bin/env node
/**
 * Publish packages/cli (devtree-ai) from the VERSION source of truth.
 *
 * Edit version only in `/VERSION` (or `npm run version:bump -- patch`).
 * This script applies manifests, refuses to republish an existing npm version,
 * then publishes.
 *
 * Usage:
 *   npm run publish:cli
 *   npm run publish:cli -- --bump-patch   # bump VERSION patch, sync, publish
 *   node scripts/publish-cli.mjs --dry-run
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const bumpPatch = args.includes("--bump-patch");

/**
 * @param {string} command
 * @param {string[]} commandArgs
 * @param {{ cwd?: string }} [opts]
 */
function run(command, commandArgs, opts = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: opts.cwd ?? root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (bumpPatch) {
  console.log("Bumping patch version from root package.json…");
  run(process.execPath, [
    join(root, "scripts", "bump-version.mjs"),
    "patch",
    ...(dryRun ? ["--dry-run"] : []),
  ]);
  if (dryRun) {
    process.exit(0);
  }
} else {
  run(process.execPath, [join(root, "scripts", "apply-version.mjs")]);
}

run(process.execPath, [
  join(root, "scripts", "assert-cli-version-publishable.mjs"),
]);

if (dryRun) {
  console.log("[dry-run] Would: npm publish --access public (in packages/cli)");
  process.exit(0);
}

run("npm", ["publish", "--access", "public"], {
  cwd: join(root, "packages", "cli"),
});
