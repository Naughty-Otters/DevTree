import { describe, expect, it } from "vitest";
import { fitCameraToContent } from "./camera";
import { createRenderState } from "./renderer";
import type { GraphNode } from "../graph/types";

describe("canvas/camera", () => {
  it("fits camera to visible nodes", () => {
    const nodes: GraphNode[] = [
      { id: "a", label: "A", path: "a.ts", loc: 1, kind: "file" },
      { id: "b", label: "B", path: "b.ts", loc: 1, kind: "file" },
    ];
    const positions = new Map([
      ["a", { id: "a", x: 0, y: 0 }],
      ["b", { id: "b", x: 100, y: 50 }],
    ]);
    const state = createRenderState(nodes, [], positions);
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    fitCameraToContent(state, canvas);
    expect(state.camera.zoom).toBeGreaterThan(0);
  });
});
