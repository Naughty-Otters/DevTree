#!/usr/bin/env node
/**
 * Guard before publishing packages/cli (devtree-ai).
 *
 * - Derived manifests must match VERSION (single source of truth)
 * - That version must not already exist on the npm registry
 *
 * Usage:
 *   node scripts/assert-cli-version-publishable.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./repo-root.mjs";

const root = repoRoot();
const versionFile = join(root, "VERSION");
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cliPkg = JSON.parse(
  readFileSync(join(root, "packages", "cli", "package.json"), "utf8"),
);
const rootVersion = existsSync(versionFile)
  ? readFileSync(versionFile, "utf8").trim().split(/\s+/)[0].replace(/^v/, "")
  : String(rootPkg.version ?? "").trim();
const pkgVersion = String(rootPkg.version ?? "").trim();
const cliVersion = String(cliPkg.version ?? "").trim();
const name = String(cliPkg.name ?? "devtree-ai").trim();

if (!rootVersion || !cliVersion || !pkgVersion) {
  console.error("Missing version in VERSION / package.json / packages/cli");
  process.exit(1);
}

if (pkgVersion !== rootVersion || cliVersion !== rootVersion) {
  console.error(
    `Derived versions out of sync with VERSION (${rootVersion}): package.json=${pkgVersion} cli=${cliVersion}. Run: npm run sync:version`,
  );
  process.exit(1);
}

const view = spawnSync(
  "npm",
  ["view", `${name}@${cliVersion}`, "version", "--silent"],
  {
    encoding: "utf8",
    shell: process.platform === "win32",
  },
);

// npm view exits 1 when the version does not exist — that is what we want.
if (view.status === 0 && String(view.stdout).trim() === cliVersion) {
  console.error(
    `npm already has ${name}@${cliVersion}.\n` +
      `Bump once via the VERSION file, then publish:\n` +
      `  npm run version:bump -- patch\n` +
      `  npm run publish:cli`,
  );
  // Distinct exit code so release CI can skip instead of failing on re-runs.
  process.exit(2);
}

console.log(`OK  ${name}@${cliVersion} is free to publish (VERSION is source of truth)`);
