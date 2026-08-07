#!/usr/bin/env node
/**
 * Apply the single source of truth (`VERSION`) to all release manifests.
 *
 * Edit version in ONE place only:
 *   VERSION
 *
 * Then run:
 *   npm run sync:version
 * or bump with:
 *   npm run version:bump -- patch
 *
 * Derived (do not hand-edit version fields):
 *   package.json, package-lock.json
 *   Cargo.toml [workspace.package]
 *   packages/cli/package.json
 *   packaging/homebrew/devtree.rb
 *   .github/badges/version.json
 *
 * Not derived (reference SSOT indirectly):
 *   src-tauri/tauri.conf.json → "../package.json"
 *   crate Cargo.toml files → version.workspace = true
 *
 * Usage:
 *   node scripts/apply-version.mjs          # write
 *   node scripts/apply-version.mjs --check  # fail if mismatched
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo-root.mjs";

const root = repoRoot();
const checkOnly = process.argv.includes("--check");
const versionPath = join(root, "VERSION");

function readVersionFile() {
  if (!existsSync(versionPath)) {
    console.error("Missing VERSION file at repo root (single source of truth)");
    process.exit(1);
  }
  const raw = readFileSync(versionPath, "utf8").trim();
  const version = raw.split(/\s+/)[0]?.replace(/^v/, "") ?? "";
  if (!/^\d+\.\d+\.\d+([.-].*)?$/.test(version)) {
    console.error(`VERSION must be semver (got ${JSON.stringify(raw)})`);
    process.exit(1);
  }
  return version;
}

const rootVersion = readVersionFile();

/**
 * @param {string} path
 * @param {() => string} read
 * @param {(next: string) => string} [write]
 */
function target(label, path, read, write) {
  return { label, path, read, write };
}

const targets = [
  target(
    "package.json",
    join(root, "package.json"),
    function read() {
      return String(JSON.parse(readFileSync(this.path, "utf8")).version ?? "").trim();
    },
    function write(next) {
      const pkg = JSON.parse(readFileSync(this.path, "utf8"));
      const previous = String(pkg.version ?? "").trim();
      pkg.version = next;
      writeFileSync(this.path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      return previous;
    },
  ),
  target(
    "package-lock.json",
    join(root, "package-lock.json"),
    function read() {
      const lock = JSON.parse(readFileSync(this.path, "utf8"));
      return String(lock.version ?? lock.packages?.[""]?.version ?? "").trim();
    },
    function write(next) {
      const lock = JSON.parse(readFileSync(this.path, "utf8"));
      const previous = String(lock.version ?? "").trim();
      lock.version = next;
      if (lock.packages?.[""]) lock.packages[""].version = next;
      writeFileSync(this.path, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
      return previous;
    },
  ),
  target(
    "Cargo.toml [workspace.package]",
    join(root, "Cargo.toml"),
    function read() {
      const text = readFileSync(this.path, "utf8");
      const block = text.match(/\[workspace\.package\]([\s\S]*?)(\n\[|\n*$)/);
      if (!block) return "";
      const match = block[1].match(/^\s*version\s*=\s*"([^"]+)"/m);
      return match?.[1]?.trim() ?? "";
    },
    function write(next) {
      const text = readFileSync(this.path, "utf8");
      const previous = this.read();
      let updated;
      if (/\[workspace\.package\]/.test(text)) {
        updated = text.replace(
          /(\[workspace\.package\][\s\S]*?^\s*version\s*=\s*")([^"]+)(")/m,
          `$1${next}$3`,
        );
        if (updated === text) {
          updated = text.replace(
            /\[workspace\.package\]/,
            `[workspace.package]\nversion = "${next}"`,
          );
        }
      } else {
        updated = `${text.trimEnd()}\n\n[workspace.package]\nversion = "${next}"\n`;
      }
      writeFileSync(this.path, updated.endsWith("\n") ? updated : `${updated}\n`, "utf8");
      return previous;
    },
  ),
  target(
    "packages/cli",
    join(root, "packages", "cli", "package.json"),
    function read() {
      return String(JSON.parse(readFileSync(this.path, "utf8")).version ?? "").trim();
    },
    function write(next) {
      const pkg = JSON.parse(readFileSync(this.path, "utf8"));
      const previous = String(pkg.version ?? "").trim();
      pkg.version = next;
      writeFileSync(this.path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      return previous;
    },
  ),
  target(
    "packaging/homebrew/devtree.rb",
    join(root, "packaging", "homebrew", "devtree.rb"),
    function read() {
      const text = readFileSync(this.path, "utf8");
      const match = text.match(/^\s*version\s+"([^"]+)"/m);
      return match?.[1]?.trim() ?? "";
    },
    function write(next) {
      const text = readFileSync(this.path, "utf8");
      const previous = this.read();
      const updated = text.replace(/^(\s*version\s+")([^"]+)(")/m, `$1${next}$3`);
      writeFileSync(this.path, updated, "utf8");
      return previous;
    },
  ),
  target(
    ".github/badges/version.json",
    join(root, ".github", "badges", "version.json"),
    function read() {
      const badge = JSON.parse(readFileSync(this.path, "utf8"));
      return String(badge.message ?? "")
        .trim()
        .replace(/^v/, "");
    },
    function write(next) {
      const badge = JSON.parse(readFileSync(this.path, "utf8"));
      const previous = this.read();
      badge.message = `v${next}`;
      writeFileSync(this.path, `${JSON.stringify(badge, null, 2)}\n`, "utf8");
      return previous;
    },
  ),
];

let mismatched = 0;
for (const t of targets) {
  if (!existsSync(t.path)) {
    console.error(`Missing ${t.label}: ${t.path}`);
    process.exit(1);
  }
  const current = t.read();
  if (current === rootVersion) {
    console.log(`OK  ${t.label} @ ${current}`);
    continue;
  }
  mismatched += 1;
  if (checkOnly) {
    console.error(`FAIL ${t.label}: ${current || "(missing)"} != VERSION ${rootVersion}`);
    continue;
  }
  const previous = t.write(rootVersion);
  console.log(`SYNC ${t.label}: ${previous || "(missing)"} → ${rootVersion}`);
}

// Guard: crate manifests must use workspace version (no local literals).
for (const rel of ["src-tauri/Cargo.toml", "crates/devtree-core/Cargo.toml"]) {
  const path = join(root, rel);
  const text = readFileSync(path, "utf8");
  const hasWorkspace = /^\s*version\.workspace\s*=\s*true/m.test(text);
  const hasLiteral = /^\s*version\s*=\s*"/m.test(text);
  if (hasWorkspace && !hasLiteral) {
    console.log(`OK  ${rel} (version.workspace = true)`);
    continue;
  }
  mismatched += 1;
  if (checkOnly) {
    console.error(`FAIL ${rel}: use version.workspace = true (no local version string)`);
    continue;
  }
  let updated = text;
  if (hasLiteral) {
    updated = updated.replace(/^\s*version\s*=\s*"[^"]+"\s*$/m, "version.workspace = true");
  } else if (!hasWorkspace) {
    updated = updated.replace(
      /^(\[package\]\s*\n)/m,
      `$1version.workspace = true\n`,
    );
  }
  writeFileSync(path, updated, "utf8");
  console.log(`SYNC ${rel}: → version.workspace = true`);
}

// Guard: tauri.conf must point at package.json, not a literal semver.
const tauriPath = join(root, "src-tauri", "tauri.conf.json");
const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
const tauriVersion = String(tauri.version ?? "");
if (tauriVersion === "../package.json") {
  console.log(`OK  src-tauri/tauri.conf.json → ../package.json`);
} else if (checkOnly) {
  mismatched += 1;
  console.error(
    `FAIL src-tauri/tauri.conf.json: version must be "../package.json" (got ${tauriVersion})`,
  );
} else {
  mismatched += 1;
  tauri.version = "../package.json";
  writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`, "utf8");
  console.log(`SYNC src-tauri/tauri.conf.json: ${tauriVersion} → ../package.json`);
}

if (checkOnly && mismatched > 0) {
  console.error(`\n${mismatched} version mismatch(es). Run: npm run sync:version`);
  process.exit(1);
}

console.log(`VERSION (source of truth) ${rootVersion}`);
