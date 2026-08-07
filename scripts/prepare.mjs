#!/usr/bin/env node
/**
 * Root `prepare` hook: apply VERSION manifests, then install husky when available.
 *
 * Must not fail in CI / publish flows where husky is absent from PATH.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { repoRoot } from "./repo-root.mjs";

const root = repoRoot();

const apply = spawnSync(
  process.execPath,
  [join(root, "scripts", "apply-version.mjs")],
  { cwd: root, stdio: "inherit" },
);
if (apply.status !== 0) {
  process.exit(apply.status ?? 1);
}

// Husky is a local devDependency — skip when missing or in CI.
if (process.env.CI === "true" || process.env.HUSKY === "0") {
  process.exit(0);
}

const huskyBin = join(root, "node_modules", "husky", "bin.js");
if (!existsSync(huskyBin)) {
  process.exit(0);
}

const husky = spawnSync(process.execPath, [huskyBin], {
  cwd: root,
  stdio: "inherit",
});
process.exit(husky.status ?? 0);
