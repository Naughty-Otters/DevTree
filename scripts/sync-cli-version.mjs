#!/usr/bin/env node
/**
 * Back-compat alias for scripts/apply-version.mjs
 * (VERSION is the single source of truth).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const result = spawnSync(
  process.execPath,
  [join(process.cwd(), "scripts", "apply-version.mjs"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
