import { describe, expect, it } from "vitest";
import { buildNodeColorMap, nodeColor } from "./colors";

describe("canvas/colors", () => {
  it("assigns stable palette colors", () => {
    expect(nodeColor("node-a")).toBe(nodeColor("node-a"));
    expect(buildNodeColorMap(["a", "b"]).size).toBe(2);
  });
});
