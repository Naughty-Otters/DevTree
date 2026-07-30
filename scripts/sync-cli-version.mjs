#!/usr/bin/env node
/**
 * Keep release-facing package versions identical to the root app version.
 *
 * Syncs:
 * - packages/cli/package.json
 * - packaging/homebrew/devtree.rb
 * - src-tauri/tauri.conf.json
 * - src-tauri/Cargo.toml (package.version)
 *
 * Usage:
 *   node scripts/sync-cli-version.mjs          # write
 *   node scripts/sync-cli-version.mjs --check  # fail if mismatched
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");

const rootPkgPath = join(root, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const rootVersion = String(rootPkg.version ?? "").trim();

if (!rootVersion) {
  console.error("Root package.json version is missing");
  process.exit(1);
}

/** @type {Array<{ label: string, path: string, read: () => string, write?: (next: string) => string }>} */
const targets = [
  {
    label: "packages/cli",
    path: join(root, "packages", "cli", "package.json"),
    read() {
      const pkg = JSON.parse(readFileSync(this.path, "utf8"));
      return String(pkg.version ?? "").trim();
    },
    write(next) {
      const pkg = JSON.parse(readFileSync(this.path, "utf8"));
      const previous = String(pkg.version ?? "").trim();
      pkg.version = next;
      writeFileSync(this.path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      return previous;
    },
  },
  {
    label: "packaging/homebrew/devtree.rb",
    path: join(root, "packaging", "homebrew", "devtree.rb"),
    read() {
      const text = readFileSync(this.path, "utf8");
      const match = text.match(/^\s*version\s+"([^"]+)"/m);
      return match?.[1]?.trim() ?? "";
    },
    write(next) {
      const text = readFileSync(this.path, "utf8");
      const previous = this.read();
      const updated = text.replace(/^(\s*version\s+")([^"]+)(")/m, `$1${next}$3`);
      writeFileSync(this.path, updated, "utf8");
      return previous;
    },
  },
  {
    label: "src-tauri/tauri.conf.json",
    path: join(root, "src-tauri", "tauri.conf.json"),
    read() {
      const cfg = JSON.parse(readFileSync(this.path, "utf8"));
      return String(cfg.version ?? "").trim();
    },
    write(next) {
      const cfg = JSON.parse(readFileSync(this.path, "utf8"));
      const previous = String(cfg.version ?? "").trim();
      cfg.version = next;
      writeFileSync(this.path, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
      return previous;
    },
  },
  {
    label: "src-tauri/Cargo.toml",
    path: join(root, "src-tauri", "Cargo.toml"),
    read() {
      const text = readFileSync(this.path, "utf8");
      const match = text.match(/^version\s*=\s*"([^"]+)"/m);
      return match?.[1]?.trim() ?? "";
    },
    write(next) {
      const text = readFileSync(this.path, "utf8");
      const previous = this.read();
      const updated = text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`);
      writeFileSync(this.path, updated, "utf8");
      return previous;
    },
  },
];

let mismatched = 0;
for (const target of targets) {
  const current = target.read();
  if (current === rootVersion) {
    console.log(`OK  ${target.label} @ ${current}`);
    continue;
  }
  mismatched += 1;
  if (checkOnly) {
    console.error(`FAIL ${target.label}: ${current || "(missing)"} != ${rootVersion}`);
    continue;
  }
  if (!target.write) {
    console.error(`Cannot write ${target.label}`);
    process.exit(1);
  }
  const previous = target.write(rootVersion);
  console.log(`SYNC ${target.label}: ${previous || "(missing)"} → ${rootVersion}`);
}

if (checkOnly && mismatched > 0) {
  console.error(`\n${mismatched} version mismatch(es). Run: node scripts/sync-cli-version.mjs`);
  process.exit(1);
}

console.log(`Root version ${rootVersion}`);
