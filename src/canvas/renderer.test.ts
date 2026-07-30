import { describe, expect, it } from "vitest";
import { createRenderState, screenToWorld, worldToScreen } from "./renderer";
import type { GraphNode } from "../graph/types";

describe("canvas/renderer", () => {
  it("converts between world and screen coordinates", () => {
    const nodes: GraphNode[] = [
      { id: "a", label: "A", path: "a.ts", loc: 1, kind: "file" },
    ];
    const positions = new Map([["a", { id: "a", x: 10, y: 20 }]]);
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const state = createRenderState(nodes, [], positions);
    const screen = worldToScreen(state.camera, canvas, 10, 20);
    const world = screenToWorld(state.camera, canvas, screen.x, screen.y);
    expect(world.x).toBeCloseTo(10, 0);
    expect(world.y).toBeCloseTo(20, 0);
  });
});
