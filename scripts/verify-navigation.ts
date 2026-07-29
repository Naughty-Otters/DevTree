/**
 * Verifies hierarchical navigation at the `src` scope.
 * Run: npx tsx scripts/verify-navigation.ts
 */
import { execSync } from "node:child_process";
import {
  drillIntoPackage,
  graphForNavigation,
  rootNavigation,
} from "../src/graph/navigation.ts";
import type { HierarchyIndex } from "../src/analysis/types.ts";

function loadHierarchy(): HierarchyIndex {
  const root = new URL("..", import.meta.url).pathname;
  const json = execSync(
    `cargo test dump_hierarchy_json -- --ignored --nocapture 2>/dev/null`,
    { cwd: `${root}/src-tauri`, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  const line = json.split("\n").find((l) => l.startsWith("HIERARCHY_JSON:"));
  if (!line) {
    throw new Error("Failed to load hierarchy JSON from cargo test");
  }
  return JSON.parse(line.slice("HIERARCHY_JSON:".length)) as HierarchyIndex;
}

const hierarchy = loadHierarchy();
let nav = rootNavigation();
nav = drillIntoPackage(nav, ".", "(root)");
nav = drillIntoPackage(nav, "src", "src");

const graph = graphForNavigation(hierarchy, nav);
const packageNodes = graph.nodes.filter((n) => n.kind === "package");
const fileNodes = graph.nodes.filter((n) => n.kind === "file");

console.log(`src scope: ${graph.nodes.length} nodes (${packageNodes.length} packages, ${fileNodes.length} files), ${graph.edges.length} edges`);

const requiredPackages = ["src/canvas", "src/graph", "src/ui"];
for (const id of requiredPackages) {
  if (!packageNodes.some((n) => n.id === id)) {
    console.error(`MISSING package node: ${id}`);
    process.exit(1);
  }
}

if (!fileNodes.some((n) => n.id === "src/main.ts")) {
  console.error("MISSING file node: src/main.ts");
  process.exit(1);
}

if (graph.edges.length < 5) {
  console.error(`Too few edges: ${graph.edges.length}`);
  process.exit(1);
}

if (!graph.edges.some((e) => e.source === "src/main.ts" && e.target === "src/canvas")) {
  console.error("MISSING edge: src/main.ts -> src/canvas");
  process.exit(1);
}

console.log("Navigation verification passed.");
