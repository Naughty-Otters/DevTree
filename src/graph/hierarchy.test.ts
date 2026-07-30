import { describe, expect, it } from "vitest";
import {
  hierarchyFromGraph,
  mockHierarchyForFixture,
  parentDir,
  topLevelPackage,
} from "./hierarchy";
import { loadFixtureGraph } from "./loadFixture";

describe("graph/hierarchy", () => {
  it("indexes packages from fixture graph", () => {
    const graph = loadFixtureGraph();
    const hierarchy = hierarchyFromGraph(graph);
    expect(hierarchy.files.length).toBeGreaterThan(0);
    expect(hierarchy.packages.length).toBeGreaterThan(0);
  });

  it("builds mock hierarchy with symbols and edges", () => {
    const graph = loadFixtureGraph();
    const hierarchy = mockHierarchyForFixture(graph);
    expect(Object.keys(hierarchy.symbols).length).toBeGreaterThan(0);
    expect(hierarchy.symbol_edges.length).toBeGreaterThan(0);
  });

  it("derives parent directory and top-level package", () => {
    expect(parentDir("src/a/b.ts")).toBe("src/a");
    expect(topLevelPackage("src/a/b.ts")).toBe("src");
    expect(topLevelPackage("main.ts")).toBe(".");
  });
});
