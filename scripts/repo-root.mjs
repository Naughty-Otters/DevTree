#!/usr/bin/env node
/**
 * Resolve the DevTree repo root.
 *
 * Prefer the path of this file (scripts/ → ..) so npm lifecycle hooks still work
 * when cwd is packages/cli during `npm publish`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} [start]
 * @returns {string}
 */
export function repoRoot(start = process.cwd()) {
  const fromScript = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (isRepoRoot(fromScript)) {
    return fromScript;
  }

  let dir = start;
  for (;;) {
    if (isRepoRoot(dir)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return fromScript;
}

/** @param {string} dir */
function isRepoRoot(dir) {
  return (
    existsSync(join(dir, "VERSION")) &&
    existsSync(join(dir, "package.json")) &&
    existsSync(join(dir, "packages", "cli", "package.json")) &&
    existsSync(join(dir, "scripts", "apply-version.mjs"))
  );
}
