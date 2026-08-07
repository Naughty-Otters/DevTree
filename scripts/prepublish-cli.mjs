#!/usr/bin/env node
/**
 * packages/cli prepublishOnly entry — always resolves repo root via this file's path.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, "..");

function run(script) {
  const result = spawnSync(process.execPath, [join(scriptsDir, script)], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("apply-version.mjs");
run("assert-cli-version-publishable.mjs");
