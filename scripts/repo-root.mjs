#!/usr/bin/env node
/**
 * Resolve the DevTree repo root even when cwd is packages/cli (npm publish).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} [start]
 * @returns {string}
 */
export function repoRoot(start = process.cwd()) {
  let dir = start;
  for (;;) {
    if (
      existsSync(join(dir, "VERSION")) &&
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "packages", "cli", "package.json"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // This file lives at scripts/repo-root.mjs → parent is always the repo root.
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}
