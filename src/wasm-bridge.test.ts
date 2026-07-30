import { describe, expect, it } from "vitest";
import { computeLayout } from "./wasm-bridge";
import type { Graph } from "./graph/types";

describe("wasm-bridge", () => {
  it("computes layout positions from graph JSON", async () => {
    const graph: Graph = { nodes: [], edges: [] };
    const positions = await computeLayout(graph);
    expect(Array.isArray(positions)).toBe(true);
  });
});
