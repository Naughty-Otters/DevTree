#!/usr/bin/env node
/**
 * Collect Tauri installers into ./release-artifacts for actions/upload-artifact.
 *
 * Reads optional JSON array from env ARTIFACT_PATHS (tauri-action output),
 * and also scrapes src-tauri/target for bundle installers (.dmg, .msi, setup .exe, …).
 *
 * Usage:
 *   ARTIFACT_PATHS='["/path/a.dmg"]' node scripts/collect-release-artifacts.mjs
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const outDir = join(root, "release-artifacts");
// tauri-action may write under src-tauri/target or repo-root target/
const searchRoots = [
  join(root, "src-tauri", "target"),
  join(root, "target"),
];

const INSTALLER_RE =
  /\.(dmg|msi|exe|app\.tar\.gz|app\.tar\.gz\.sig|deb|AppImage|rpm)$/i;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (
        name === "deps" ||
        name === "build" ||
        name === ".fingerprint" ||
        name === "incremental"
      ) {
        continue;
      }
      walk(path, out);
    } else if (st.isFile()) {
      out.push(path);
    }
  }
  return out;
}

function isBundleInstaller(path) {
  const norm = path.replace(/\\/g, "/");
  if (!norm.includes("/bundle/")) return false;
  if (norm.includes("/nsis/x64/") && norm.endsWith(".exe")) return true;
  return INSTALLER_RE.test(basename(path)) || /\.app$/i.test(basename(path));
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** @type {string[]} */
const fromAction = [];
const raw = process.env.ARTIFACT_PATHS?.trim() || "";
if (raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const p of parsed) {
        if (typeof p === "string" && p) fromAction.push(p);
      }
    }
  } catch {
    // tauri-action sometimes prints a comma-separated list
    for (const p of raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)) {
      fromAction.push(p.replace(/^"|"$/g, ""));
    }
  }
}

const candidates = new Set(fromAction);
for (const searchRoot of searchRoots) {
  for (const file of walk(searchRoot)) {
    if (isBundleInstaller(file)) candidates.add(file);
  }
}

let copied = 0;
const manifest = [];

for (const srcPath of candidates) {
  if (!existsSync(srcPath)) {
    console.warn(`skip missing: ${srcPath}`);
    continue;
  }
  const st = statSync(srcPath);
  const name = basename(srcPath);
  const dest = join(outDir, name);
  if (st.isDirectory()) {
    cpSync(srcPath, dest, { recursive: true });
  } else {
    // Avoid collisions by prefixing with a short parent folder hint.
    let finalDest = dest;
    if (existsSync(finalDest)) {
      const parent = basename(join(srcPath, ".."));
      finalDest = join(outDir, `${parent}-${name}`);
    }
    copyFileSync(srcPath, finalDest);
  }
  copied += 1;
  manifest.push(relative(root, srcPath));
  console.log(`+ ${relative(root, srcPath)}`);
}

writeFileSync(
  join(outDir, "manifest.json"),
  `${JSON.stringify({ copied, files: manifest, fromAction }, null, 2)}\n`,
);

if (copied === 0) {
  console.warn("No installers found under target dirs or ARTIFACT_PATHS.");
  console.warn("Listing bundle directories for debugging:");
  for (const searchRoot of searchRoots) {
    for (const file of walk(searchRoot)) {
      const norm = file.replace(/\\/g, "/");
      if (norm.includes("/bundle/")) console.warn(`  ${relative(root, file)}`);
    }
  }
}

console.log(`Collected ${copied} artifact(s) into ${relative(root, outDir)}/`);
process.exit(0);
