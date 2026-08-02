import { describe, expect, it } from "vitest";
import {
  curvedEdgePath,
  orthogonalEdgePoints,
  parseEdgeStyle,
} from "./edgeStyle";

describe("canvas/edgeStyle", () => {
  it("parses edge style names", () => {
    expect(parseEdgeStyle("straight")).toBe("straight");
    expect(parseEdgeStyle("orthogonal")).toBe("orthogonal");
    expect(parseEdgeStyle("angled")).toBe("orthogonal");
    expect(parseEdgeStyle("curved")).toBe("curved");
    expect(parseEdgeStyle("bezier")).toBe("curved");
    expect(parseEdgeStyle("nope")).toBe("straight");
  });

  it("builds axis-aligned routes", () => {
    const pts = orthogonalEdgePoints(0, 0, 100, 40, 5, 5, 0);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const horiz = Math.abs(a.y - b.y) < 1e-6;
      const vert = Math.abs(a.x - b.x) < 1e-6;
      expect(horiz || vert).toBe(true);
    }
  });

  it("builds a curved path that arrives radially into the target", () => {
    const path = curvedEdgePath(0, 0, 100, 0, 5, 5, 0, 6);
    expect(path).toBeTruthy();
    // Tip sits on the +x approach into the target.
    expect(path!.tip.x).toBeCloseTo(95, 0);
    expect(path!.tip.y).toBeCloseTo(0, 5);
    // Arrival tangent should be nearly along +x (into the node).
    expect(Math.cos(path!.tipAngle)).toBeGreaterThan(0.95);
    // Stroke ends before the tip along the curve.
    expect(path!.end.x).toBeLessThan(path!.tip.x);
  });
});
