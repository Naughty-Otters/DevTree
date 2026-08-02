import type { GraphEdge, GraphNode } from "../graph/types";
import type { PositionedNode } from "../wasm-bridge";
import { nodeColor } from "./colors";
import { dependencyNeighborhood, isEdgeHighlighted } from "./highlights";
import { pathNodeShape, nodeKindColor, drawNodeKindBadge } from "./nodeIcons";
import {
  curvedEdgePath,
  orthogonalEdgePoints,
  type EdgeStyle,
} from "./edgeStyle";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Map<string, PositionedNode>;
  camera: Camera;
  hoveredId: string | null;
  selectedId: string | null;
  /** When set, highlights this node and its direct dependencies/dependents. */
  highlightId: string | null;
  /** When set, highlights specific nodes and edges (e.g. import cycles). */
  highlightCycle?: {
    nodeIds: Set<string>;
    edgeKeys: Set<string>;
  };
  hiddenIds: Set<string>;
  /**
   * Per-node opacity for hide/show transitions (0–1).
   * When unset, visibility follows `hiddenIds` (hidden → 0, else 1).
   */
  nodeAlpha: Map<string, number>;
  nodeColors: Map<string, string>;
  /** Dependency link routing style. */
  edgeStyle: EdgeStyle;
}

const MIN_RADIUS = 6.5;
const MAX_RADIUS = 13;
const DIMMED_NODE_FILL = "rgba(60, 65, 75, 0.35)";
const DIMMED_EDGE_STROKE = "rgba(80, 88, 100, 0.12)";
const DIMMED_EDGE_FILL = "rgba(80, 88, 100, 0.12)";
const ACTIVE_EDGE_STROKE = "rgba(150, 200, 255, 0.75)";
const ACTIVE_EDGE_FILL = "rgba(150, 200, 255, 0.85)";
const DEFAULT_EDGE_STROKE = "rgba(150, 160, 180, 0.28)";
const DEFAULT_EDGE_FILL = "rgba(150, 160, 180, 0.45)";
/** Label size in CSS px — stays roughly constant on screen, not world-scaled. */
const LABEL_CSS_PX = 10;
const LABEL_MAX_CSS_PX = 72;

function nodeRadius(loc: number, maxLoc: number): number {
  if (maxLoc <= 0) return MIN_RADIUS;
  const t = Math.sqrt(loc / maxLoc);
  return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
}

export function worldToScreen(camera: Camera, canvas: HTMLCanvasElement, x: number, y: number) {
  return {
    x: canvas.width / 2 + (x + camera.x) * camera.zoom,
    y: canvas.height / 2 + (y + camera.y) * camera.zoom,
  };
}

export function screenToWorld(camera: Camera, canvas: HTMLCanvasElement, sx: number, sy: number) {
  return {
    x: (sx - canvas.width / 2) / camera.zoom - camera.x,
    y: (sy - canvas.height / 2) / camera.zoom - camera.y,
  };
}

function nodeAlpha(state: RenderState, id: string): number {
  const animated = state.nodeAlpha.get(id);
  if (animated !== undefined) return animated;
  return state.hiddenIds.has(id) ? 0 : 1;
}

function isVisible(state: RenderState, id: string): boolean {
  return nodeAlpha(state, id) > 0.02;
}

function locById(state: RenderState): Map<string, number> {
  const map = new Map<string, number>();
  for (const n of state.nodes) map.set(n.id, n.loc);
  return map;
}

function drawDirectedEdge(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  sourceR: number,
  targetR: number,
  zoom: number,
  highlighted: boolean,
  style: EdgeStyle = "straight",
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  const pad = 2;
  const arrowLen = Math.max(5, 6 * Math.min(zoom, 1.5));
  const headSize = Math.max(4, 5.5 * Math.min(zoom, 1.5));

  ctx.strokeStyle = highlighted ? ACTIVE_EDGE_STROKE : DEFAULT_EDGE_STROKE;
  ctx.fillStyle = highlighted ? ACTIVE_EDGE_FILL : DEFAULT_EDGE_FILL;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  let tipX: number;
  let tipY: number;
  let angle: number;

  if (style === "orthogonal") {
    const points = orthogonalEdgePoints(ax, ay, bx, by, sourceR, targetR, pad);
    if (points.length < 2) return;

    // Shorten the last segment slightly so the arrow tip sits cleanly.
    const last = points[points.length - 1]!;
    const prev = points[points.length - 2]!;
    const ldx = last.x - prev.x;
    const ldy = last.y - prev.y;
    const llen = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
    const lux = ldx / llen;
    const luy = ldy / llen;
    const drawLast = {
      x: last.x - lux * Math.min(arrowLen * 0.45, llen * 0.4),
      y: last.y - luy * Math.min(arrowLen * 0.45, llen * 0.4),
    };

    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length - 1; i++) {
      ctx.lineTo(points[i]!.x, points[i]!.y);
    }
    ctx.lineTo(drawLast.x, drawLast.y);
    ctx.stroke();

    tipX = last.x;
    tipY = last.y;
    angle = Math.atan2(luy, lux);
  } else if (style === "curved") {
    const path = curvedEdgePath(
      ax,
      ay,
      bx,
      by,
      sourceR,
      targetR,
      pad,
      Math.max(headSize * 0.85, arrowLen * 0.55),
    );
    if (!path) return;

    ctx.beginPath();
    ctx.moveTo(path.start.x, path.start.y);
    ctx.bezierCurveTo(
      path.c1.x,
      path.c1.y,
      path.c2.x,
      path.c2.y,
      path.end.x,
      path.end.y,
    );
    ctx.stroke();

    // Connect stroke end → tip along the arrival tangent so there's no gap.
    const joinX = path.tip.x - Math.cos(path.tipAngle) * 0.5;
    const joinY = path.tip.y - Math.sin(path.tipAngle) * 0.5;
    ctx.beginPath();
    ctx.moveTo(path.end.x, path.end.y);
    ctx.lineTo(joinX, joinY);
    ctx.stroke();

    tipX = path.tip.x;
    tipY = path.tip.y;
    angle = path.tipAngle;
  } else {
    const ux = dx / len;
    const uy = dy / len;
    const startX = ax + ux * (sourceR + pad);
    const startY = ay + uy * (sourceR + pad);
    const endX = bx - ux * (targetR + pad + arrowLen * 0.5);
    const endY = by - uy * (targetR + pad + arrowLen * 0.5);

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    tipX = bx - ux * (targetR + pad);
    tipY = by - uy * (targetR + pad);
    angle = Math.atan2(uy, ux);
  }

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - headSize * Math.cos(angle - Math.PI / 6),
    tipY - headSize * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    tipX - headSize * Math.cos(angle + Math.PI / 6),
    tipY - headSize * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

export function render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, state: RenderState) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f1115";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const visibleNodes = state.nodes.filter((n) => isVisible(state, n.id));
  // Avoid Math.max(...hugeArray) — spread blows the stack / hangs on large graphs.
  let maxLoc = 1;
  for (const n of visibleNodes) {
    if (n.loc > maxLoc) maxLoc = n.loc;
  }
  const locs = locById(state);

  const focusId = state.highlightId;
  const cycleHighlight = state.highlightCycle;
  const cycleHighlightActive =
    cycleHighlight != null && cycleHighlight.nodeIds.size > 0;
  const neighborhood =
    focusId != null && !cycleHighlightActive
      ? dependencyNeighborhood(focusId, state.edges)
      : null;
  const dimming = neighborhood != null || cycleHighlightActive;

  const lineWidth = Math.max(0.75, Math.min(1.5, 1.0 * state.camera.zoom));
  ctx.lineWidth = lineWidth;

  for (const edge of state.edges) {
    const edgeAlpha = Math.min(
      nodeAlpha(state, edge.source),
      nodeAlpha(state, edge.target),
    );
    if (edgeAlpha <= 0.02) continue;
    const from = state.positions.get(edge.source);
    const to = state.positions.get(edge.target);
    if (!from || !to) continue;

    const highlighted = cycleHighlightActive
      ? cycleHighlight!.edgeKeys.has(`${edge.source}->${edge.target}`) ||
        (cycleHighlight!.nodeIds.has(edge.source) &&
          cycleHighlight!.nodeIds.has(edge.target))
      : focusId != null && isEdgeHighlighted(edge, focusId, neighborhood!);

    if (dimming && !highlighted) {
      ctx.strokeStyle = DIMMED_EDGE_STROKE;
      ctx.fillStyle = DIMMED_EDGE_FILL;
    }

    const a = worldToScreen(state.camera, canvas, from.x, from.y);
    const b = worldToScreen(state.camera, canvas, to.x, to.y);

    const sourceLoc = locs.get(edge.source) ?? 1;
    const targetLoc = locs.get(edge.target) ?? 1;
    const sourceR = nodeRadius(sourceLoc, maxLoc) * state.camera.zoom;
    const targetR = nodeRadius(targetLoc, maxLoc) * state.camera.zoom;

    ctx.save();
    ctx.globalAlpha = edgeAlpha;
    drawDirectedEdge(
      ctx,
      a.x,
      a.y,
      b.x,
      b.y,
      sourceR,
      targetR,
      state.camera.zoom,
      highlighted,
      state.edgeStyle ?? "straight",
    );
    ctx.restore();
  }

  const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  const showLabels = state.camera.zoom > 0.4;
  const labelFontPx = LABEL_CSS_PX * dpr;
  const labelMaxW = LABEL_MAX_CSS_PX * dpr;

  for (const node of visibleNodes) {
    const pos = state.positions.get(node.id);
    if (!pos) continue;
    const alpha = nodeAlpha(state, node.id);
    const screen = worldToScreen(state.camera, canvas, pos.x, pos.y);
    const radius =
      nodeRadius(node.loc, maxLoc) * state.camera.zoom * (0.55 + 0.45 * alpha);

    const isCycleNode = cycleHighlightActive
      ? (cycleHighlight!.nodeIds.has(node.id) ?? false)
      : false;
    const inNeighborhood = cycleHighlightActive
      ? isCycleNode
      : !dimming || neighborhood!.has(node.id);
    const isFocus = focusId === node.id || isCycleNode;
    const isSelected = state.selectedId === node.id;
    const isHovered = state.hoveredId === node.id;
    const baseColor = state.nodeColors.get(node.id) ?? nodeColor(node.id);
    const kindTint = nodeKindColor(node.kind || "symbol");
    const kind = node.kind || "symbol";

    ctx.save();
    ctx.globalAlpha = alpha;

    pathNodeShape(ctx, kind, screen.x, screen.y, radius);

    if (!inNeighborhood) {
      ctx.fillStyle = DIMMED_NODE_FILL;
    } else if (isFocus || isSelected) {
      ctx.fillStyle = mixHex(baseColor, "#ffffff", 0.55);
    } else if (isHovered) {
      ctx.fillStyle = lighten(baseColor);
    } else {
      ctx.fillStyle = mixHex(baseColor, kindTint, 0.18);
    }
    ctx.fill();

    ctx.lineWidth = Math.max(1, Math.min(1.75, 1.15 * Math.min(state.camera.zoom, 1.8)));
    if (!inNeighborhood) {
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
    } else if (isFocus || isSelected) {
      ctx.strokeStyle = kindTint;
      ctx.lineWidth = Math.max(1.5, ctx.lineWidth);
    } else if (isHovered) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
    } else {
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
    }
    ctx.stroke();

    if (inNeighborhood) {
      // Type icon scales with the node — ~half the diameter, with a small floor.
      const badgePx = Math.max(5, radius * 0.92);
      if (badgePx >= 5) {
        const iconColor =
          isFocus || isSelected ? "rgba(15, 17, 21, 0.92)" : "rgba(15, 17, 21, 0.78)";
        drawNodeKindBadge(
          ctx,
          kind,
          screen.x,
          screen.y,
          radius,
          badgePx,
          iconColor,
        );
      }
    }

    if (inNeighborhood && showLabels && alpha > 0.35) {
      const emphasize = isFocus || isSelected || isHovered;
      drawNodeLabel(ctx, {
        text: node.label,
        x: screen.x,
        y: screen.y + radius + 3 * dpr,
        fontPx: emphasize ? labelFontPx + 0.5 * dpr : labelFontPx,
        maxWidth: emphasize ? labelMaxW * 1.25 : labelMaxW,
        color: emphasize
          ? "#d7dde8"
          : dimming && !isFocus
            ? "rgba(180, 188, 204, 0.7)"
            : "rgba(168, 176, 192, 0.88)",
      });
    }

    ctx.restore();
  }
}

function truncateLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  opts: {
    text: string;
    x: number;
    y: number;
    fontPx: number;
    maxWidth: number;
    color: string;
  },
): void {
  const fontPx = Math.max(8, opts.fontPx);
  ctx.font = `500 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const label = truncateLabel(ctx, opts.text, opts.maxWidth);

  // Compact halo instead of large fill — keeps type readable without bulk.
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2.5, fontPx * 0.28);
  ctx.strokeStyle = "rgba(15, 17, 21, 0.82)";
  ctx.strokeText(label, opts.x, opts.y);
  ctx.fillStyle = opts.color;
  ctx.fillText(label, opts.x, opts.y);
}

function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });
  const A = parse(a);
  const B = parse(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${m(A.r, B.r)},${m(A.g, B.g)},${m(A.b, B.b)})`;
}

function lighten(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.35));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function hitTest(state: RenderState, canvas: HTMLCanvasElement, sx: number, sy: number): string | null {
  const visibleNodes = state.nodes.filter((n) => isVisible(state, n.id));
  const maxLoc = Math.max(1, ...visibleNodes.map((n) => n.loc));
  let closestId: string | null = null;
  let closestDist = Infinity;

  for (const node of visibleNodes) {
    const pos = state.positions.get(node.id);
    if (!pos) continue;
    const screen = worldToScreen(state.camera, canvas, pos.x, pos.y);
    const radius = nodeRadius(node.loc, maxLoc) * state.camera.zoom;
    const dx = sx - screen.x;
    const dy = sy - screen.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= radius + 4 && dist < closestDist) {
      closestDist = dist;
      closestId = node.id;
    }
  }

  return closestId;
}

export function createRenderState(
  nodes: GraphNode[],
  edges: GraphEdge[],
  positions: Map<string, PositionedNode>,
): RenderState {
  return {
    nodes,
    edges,
    positions,
    camera: { x: 0, y: 0, zoom: 1 },
    hoveredId: null,
    selectedId: null,
    highlightId: null,
    hiddenIds: new Set(),
    nodeAlpha: new Map(),
    nodeColors: new Map(nodes.map((n) => [n.id, nodeColor(n.id)])),
    edgeStyle: "straight",
  };
}
