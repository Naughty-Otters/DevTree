import { describe, expect, it } from "vitest";
import { loadFixtureGraph } from "./loadFixture";

describe("graph/loadFixture", () => {
  it("loads a non-empty fixture graph", () => {
    const graph = loadFixtureGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
  });
});
