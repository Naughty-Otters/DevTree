export type EdgeStyle = "straight" | "orthogonal" | "curved";

export const EDGE_STYLES: { value: EdgeStyle; label: string; hint: string }[] = [
  {
    value: "straight",
    label: "Straight",
    hint: "Direct line between modules",
  },
  {
    value: "orthogonal",
    label: "Orthogonal",
    hint: "Horizontal and vertical segments only",
  },
  {
    value: "curved",
    label: "Curved",
    hint: "Smooth bezier curve between modules",
  },
];

export function parseEdgeStyle(value: unknown): EdgeStyle {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "orthogonal" || s === "angled" || s === "manhattan" || s === "hv") {
    return "orthogonal";
  }
  if (s === "curved" || s === "curve" || s === "bezier" || s === "arc") {
    return "curved";
  }
  return "straight";
}

export interface EdgePoint {
  x: number;
  y: number;
}

/**
 * Orthogonal (Manhattan) route: only horizontal/vertical segments.
 * Returns polyline points from source exit to target approach (before arrow tip).
 */
export function orthogonalEdgePoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  sourceR: number,
  targetR: number,
  pad = 2,
): EdgePoint[] {
  const dx = bx - ax;
  const dy = by - ay;
  const alignEps = 3;

  if (Math.abs(dy) <= alignEps) {
    const dir = Math.sign(dx) || 1;
    return [
      { x: ax + dir * (sourceR + pad), y: ay },
      { x: bx - dir * (targetR + pad), y: by },
    ];
  }

  if (Math.abs(dx) <= alignEps) {
    const dir = Math.sign(dy) || 1;
    return [
      { x: ax, y: ay + dir * (sourceR + pad) },
      { x: bx, y: by - dir * (targetR + pad) },
    ];
  }

  // Prefer the longer axis as the outer runs (H-V-H or V-H-V).
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = (ax + bx) / 2;
    const out = Math.sign(midX - ax) || Math.sign(dx) || 1;
    const inn = Math.sign(bx - midX) || Math.sign(dx) || 1;
    return [
      { x: ax + out * (sourceR + pad), y: ay },
      { x: midX, y: ay },
      { x: midX, y: by },
      { x: bx - inn * (targetR + pad), y: by },
    ];
  }

  const midY = (ay + by) / 2;
  const out = Math.sign(midY - ay) || Math.sign(dy) || 1;
  const inn = Math.sign(by - midY) || Math.sign(dy) || 1;
  return [
    { x: ax, y: ay + out * (sourceR + pad) },
    { x: ax, y: midY },
    { x: bx, y: midY },
    { x: bx, y: by - inn * (targetR + pad) },
  ];
}

export interface CurvedEdgePath {
  start: EdgePoint;
  /** Cubic bezier control points. */
  c1: EdgePoint;
  c2: EdgePoint;
  /** End of stroked curve (short of the arrow tip along the curve). */
  end: EdgePoint;
  /** Arrow tip on the target node edge. */
  tip: EdgePoint;
  /** Outgoing tangent angle at the tip (radians). */
  tipAngle: number;
}

function cubicPoint(
  p0: EdgePoint,
  p1: EdgePoint,
  p2: EdgePoint,
  p3: EdgePoint,
  t: number,
): EdgePoint {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function cubicTangent(
  p0: EdgePoint,
  p1: EdgePoint,
  p2: EdgePoint,
  p3: EdgePoint,
  t: number,
): EdgePoint {
  const u = 1 - t;
  // B'(t) = 3(1-t)^2 (P1-P0) + 6(1-t)t (P2-P1) + 3t^2 (P3-P2)
  return {
    x:
      3 * u * u * (p1.x - p0.x) +
      6 * u * t * (p2.x - p1.x) +
      3 * t * t * (p3.x - p2.x),
    y:
      3 * u * u * (p1.y - p0.y) +
      6 * u * t * (p2.y - p1.y) +
      3 * t * t * (p3.y - p2.y),
  };
}

/**
 * Cubic bezier with a side bend, but a radial approach into the target so the
 * arrowhead sits flush on the node and matches the curve tangent.
 */
export function curvedEdgePath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  sourceR: number,
  targetR: number,
  pad = 2,
  arrowInset = 6,
): CurvedEdgePath | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const bend = Math.min(52, Math.max(12, len * 0.2));
  const handle = Math.min(len * 0.35, Math.max(18, len * 0.28));

  // Leave / enter along the chord so endpoints sit on the node outline.
  const start = {
    x: ax + ux * (sourceR + pad),
    y: ay + uy * (sourceR + pad),
  };
  const tip = {
    x: bx - ux * (targetR + pad),
    y: by - uy * (targetR + pad),
  };

  // Bend early; keep the second handle almost radial into the target so the
  // tip tangent matches the arrow (into the node center).
  const c1 = {
    x: start.x + ux * handle + px * bend,
    y: start.y + uy * handle + py * bend,
  };
  const c2 = {
    x: tip.x - ux * handle,
    y: tip.y - uy * handle,
  };

  const tipTan = cubicTangent(start, c1, c2, tip, 1);
  const tipAngle = Math.atan2(tipTan.y, tipTan.x);

  // Stop the stroke just before the tip, along the true curve.
  const inset = Math.min(arrowInset, len * 0.2);
  const tEnd = Math.max(0.72, 1 - inset / Math.max(len, 1));
  const end = cubicPoint(start, c1, c2, tip, tEnd);

  return { start, c1, c2, end, tip, tipAngle };
}
