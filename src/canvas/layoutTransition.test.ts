import { describe, expect, it, vi } from "vitest";
import {
  animateLayoutTransition,
  animateVisibilityTransition,
  cancelLayoutTransition,
} from "./layoutTransition";
import { createRenderState } from "./renderer";
import type { GraphNode } from "../graph/types";

describe("canvas/layoutTransition", () => {
  it("interpolates positions toward the target", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now() + 600);
      return 1;
    });

    const nodes: GraphNode[] = [
      { id: "a", label: "A", path: "a", loc: 1, kind: "file" },
    ];
    const start = new Map([["a", { id: "a", x: 0, y: 0 }]]);
    const state = createRenderState(nodes, [], start);
    const target = new Map([["a", { id: "a", x: 100, y: 50 }]]);

    await animateLayoutTransition(state, target, () => {}, { durationMs: 100 });

    expect(state.positions.get("a")?.x).toBeCloseTo(100, 0);
    expect(state.positions.get("a")?.y).toBeCloseTo(50, 0);
    cancelLayoutTransition();
    vi.unstubAllGlobals();
  });

  it("fades hide/show before committing hiddenIds", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now() + 400);
      return 1;
    });

    const nodes: GraphNode[] = [
      { id: "a", label: "A", path: "a", loc: 1, kind: "file" },
      { id: "b", label: "B", path: "b", loc: 1, kind: "file" },
    ];
    const positions = new Map([
      ["a", { id: "a", x: 0, y: 0 }],
      ["b", { id: "b", x: 10, y: 0 }],
    ]);
    const state = createRenderState(nodes, [], positions);

    await animateVisibilityTransition(state, new Set(["a"]), () => {}, {
      durationMs: 100,
    });

    expect(state.hiddenIds.has("b")).toBe(true);
    expect(state.hiddenIds.has("a")).toBe(false);
    expect(state.nodeAlpha.size).toBe(0);
    cancelLayoutTransition();
    vi.unstubAllGlobals();
  });
});
