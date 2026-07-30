import { describe, expect, it } from "vitest";
import type { Graph } from "./types";

describe("graph/types", () => {
  it("accepts a minimal graph shape", () => {
    const graph: Graph = {
      nodes: [{ id: "n", label: "N", path: "n.ts", loc: 1, kind: "file" }],
      edges: [],
    };
    expect(graph.nodes[0].id).toBe("n");
  });
});
