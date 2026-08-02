import { describe, expect, it } from "vitest";
import {
  computeLayout,
  familyFromLayoutMode,
  layoutModeFromFamily,
  parseLayoutMode,
} from "./wasm-bridge";
import type { Graph } from "./graph/types";

describe("wasm-bridge", () => {
  it("computes layout positions from graph JSON", async () => {
    const graph: Graph = { nodes: [], edges: [] };
    const positions = await computeLayout(graph);
    expect(Array.isArray(positions)).toBe(true);
  });

  it("accepts a layout mode argument", async () => {
    const graph: Graph = { nodes: [], edges: [] };
    const positions = await computeLayout(graph, "hierarchical");
    expect(Array.isArray(positions)).toBe(true);
  });

  it("parses layout mode names", () => {
    expect(parseLayoutMode("radial")).toBe("radial");
    expect(parseLayoutMode("cluster")).toBe("cluster");
    expect(parseLayoutMode("TREE")).toBe("tree");
    expect(parseLayoutMode("direct")).toBe("direct");
    expect(parseLayoutMode("dag")).toBe("direct");
    expect(parseLayoutMode("nope")).toBe("organic");
    expect(parseLayoutMode(undefined)).toBe("organic");
  });

  it("maps DAG family to direct vs hierarchical modes", () => {
    expect(familyFromLayoutMode("direct")).toBe("dag");
    expect(familyFromLayoutMode("hierarchical")).toBe("dag");
    expect(layoutModeFromFamily("dag", "direct")).toBe("direct");
    expect(layoutModeFromFamily("dag", "hierarchical")).toBe("hierarchical");
    expect(layoutModeFromFamily("organic")).toBe("organic");
  });
});
