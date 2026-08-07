#!/usr/bin/env node
/**
 * Writes Shields.io endpoint JSON for README badges (version + coverage).
 * Intended to run after `npm run test:coverage` so coverage-summary.json exists.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".github", "badges");

function coverageColor(pct) {
  if (pct >= 90) return "brightgreen";
  if (pct >= 80) return "green";
  if (pct >= 65) return "yellow";
  return "red";
}

const versionFile = join(root, "VERSION");
const version = existsSync(versionFile)
  ? readFileSync(versionFile, "utf8").trim().split(/\s+/)[0].replace(/^v/, "")
  : JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const summaryPath = join(root, "coverage", "coverage-summary.json");
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const linesPct = Number(summary.total?.lines?.pct ?? 0);
const message = `${linesPct % 1 === 0 ? linesPct : linesPct.toFixed(1)}%`;

mkdirSync(outDir, { recursive: true });

writeFileSync(
  join(outDir, "version.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      label: "version",
      message: `v${version}`,
      color: "blue",
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(outDir, "coverage.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      label: "coverage",
      message,
      color: coverageColor(linesPct),
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote badges → version v${version}, coverage ${message}`);
