#!/usr/bin/env node
/**
 * Ensures every application source file has a corresponding unit test.
 * TypeScript: each src .ts file has a sibling .test.ts (excluding generated wasm types)
 * Rust: each .rs under src-tauri/src and crates has at least one #[test]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TS_SKIP = new Set([
  join(root, "src/wasm/devtree_core.d.ts"),
  join(root, "src/wasm/devtree_core_bg.wasm.d.ts"),
]);

const RUST_SKIP = new Set([
  join(root, "src-tauri/build.rs"),
]);

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "target" || name === "wasm" || name === "test") continue;
      walk(path, ext, out);
    } else if (path.endsWith(ext)) {
      out.push(path);
    }
  }
  return out;
}

const errors = [];

const tsFiles = walk(join(root, "src"), ".ts").filter(
  (p) => !p.endsWith(".test.ts") && !TS_SKIP.has(p),
);

for (const file of tsFiles) {
  const testFile = file.replace(/\.ts$/, ".test.ts");
  try {
    statSync(testFile);
  } catch {
    errors.push(`Missing TypeScript test: ${relative(root, testFile)} (for ${relative(root, file)})`);
  }
}

const rustFiles = [
  ...walk(join(root, "src-tauri/src"), ".rs"),
  ...walk(join(root, "crates/devtree-core/src"), ".rs"),
].filter((p) => !RUST_SKIP.has(p));

for (const file of rustFiles) {
  const content = readFileSync(file, "utf8");
  if (!/#\[(test|tokio::test)\]/.test(content)) {
    errors.push(`Missing Rust #[test] in ${relative(root, file)}`);
  }
}

if (errors.length > 0) {
  console.error("Unit test coverage check failed:\n");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `Unit test coverage OK (${tsFiles.length} TypeScript + ${rustFiles.length} Rust source files).`,
);
