import { describe, expect, it } from "vitest";
import { dependencyNeighborhood, isEdgeHighlighted } from "./highlights";

describe("canvas/highlights", () => {
  it("detects highlighted edges in a neighborhood", () => {
    const edge = { source: "a", target: "b", kind: "import" };
    const neighborhood = dependencyNeighborhood("a", [edge]);
    expect(isEdgeHighlighted(edge, "a", neighborhood)).toBe(true);
  });
});
