import type { GraphEdge, GraphNode } from "../graph/types";
import type { PositionedNode } from "../wasm-bridge";
import { nodeColor } from "./colors";
import { dependencyNeighborhood, isEdgeHighlighted } from "./highlights";
import { pathNodeShape, nodeKindColor, drawNodeKindBadge, NODE_KIND_BADGE_CSS_PX } from "./nodeIcons";

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
  hiddenIds: Set<string>;
  nodeColors: Map<string, string>;
}

const MIN_RADIUS = 10;
const MAX_RADIUS = 22;
const DIMMED_NODE_FILL = "rgba(60, 65, 75, 0.35)";
const DIMMED_EDGE_STROKE = "rgba(80, 88, 100, 0.12)";
const DIMMED_EDGE_FILL = "rgba(80, 88, 100, 0.12)";
const ACTIVE_EDGE_STROKE = "rgba(150, 200, 255, 0.75)";
const ACTIVE_EDGE_FILL = "rgba(150, 200, 255, 0.85)";
const DEFAULT_EDGE_STROKE = "rgba(150, 160, 180, 0.35)";
const DEFAULT_EDGE_FILL = "rgba(150, 160, 180, 0.55)";

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

function isVisible(state: RenderState, id: string): boolean {
  return !state.hiddenIds.has(id);
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
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  const ux = dx / len;
  const uy = dy / len;
  const pad = 2;
  const arrowLen = Math.max(7, 9 * zoom);
  const startX = ax + ux * (sourceR + pad);
  const startY = ay + uy * (sourceR + pad);
  const endX = bx - ux * (targetR + pad + arrowLen * 0.5);
  const endY = by - uy * (targetR + pad + arrowLen * 0.5);

  ctx.strokeStyle = highlighted ? ACTIVE_EDGE_STROKE : DEFAULT_EDGE_STROKE;
  ctx.fillStyle = highlighted ? ACTIVE_EDGE_FILL : DEFAULT_EDGE_FILL;

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  const angle = Math.atan2(uy, ux);
  const headSize = Math.max(5, 7 * zoom);
  const tipX = bx - ux * (targetR + pad);
  const tipY = by - uy * (targetR + pad);

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

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, state: RenderState) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f1115";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const visibleNodes = state.nodes.filter((n) => isVisible(state, n.id));
  const maxLoc = Math.max(1, ...visibleNodes.map((n) => n.loc));
  const locs = locById(state);

  const focusId = state.highlightId;
  const neighborhood =
    focusId != null ? dependencyNeighborhood(focusId, state.edges) : null;
  const dimming = neighborhood != null;

  const lineWidth = Math.max(1, 1.2 * state.camera.zoom);
  ctx.lineWidth = lineWidth;

  for (const edge of state.edges) {
    if (!isVisible(state, edge.source) || !isVisible(state, edge.target)) continue;
    const from = state.positions.get(edge.source);
    const to = state.positions.get(edge.target);
    if (!from || !to) continue;

    const highlighted =
      focusId != null && isEdgeHighlighted(edge, focusId, neighborhood!);

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
    );
  }

  for (const node of visibleNodes) {
    const pos = state.positions.get(node.id);
    if (!pos) continue;
    const screen = worldToScreen(state.camera, canvas, pos.x, pos.y);
    const radius = nodeRadius(node.loc, maxLoc) * state.camera.zoom;

    const inNeighborhood = !dimming || neighborhood!.has(node.id);
    const isFocus = focusId === node.id;
    const isSelected = state.selectedId === node.id;
    const isHovered = state.hoveredId === node.id;
    const baseColor = state.nodeColors.get(node.id) ?? nodeColor(node.id);
    const kindTint = nodeKindColor(node.kind || "symbol");

    pathNodeShape(ctx, node.kind || "symbol", screen.x, screen.y, radius);

    if (!inNeighborhood) {
      ctx.fillStyle = DIMMED_NODE_FILL;
    } else if (isFocus || isSelected) {
      ctx.fillStyle = "#ffffff";
    } else if (isHovered) {
      ctx.fillStyle = lighten(baseColor);
    } else {
      ctx.fillStyle = mixHex(baseColor, kindTint, 0.22);
    }
    ctx.fill();

    ctx.lineWidth = Math.max(1.5, 1.5 * state.camera.zoom);
    if (!inNeighborhood) {
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
    } else if (isFocus) {
      ctx.strokeStyle = kindTint;
      ctx.lineWidth = 3;
    } else if (isSelected) {
      ctx.strokeStyle = kindTint;
    } else {
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
    }
    ctx.stroke();

    if (inNeighborhood && (isFocus || isSelected || isHovered)) {
      pathNodeShape(ctx, node.kind || "symbol", screen.x, screen.y, radius);
      ctx.lineWidth = isFocus ? 3 : 2.5;
      ctx.strokeStyle = isFocus ? kindTint : "#ffffff";
      ctx.stroke();
    }

    if (inNeighborhood) {
      const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
      // Keep icons a consistent screen size, slightly larger when the node is big.
      const badgePx = Math.max(
        NODE_KIND_BADGE_CSS_PX * dpr,
        Math.min(radius * 0.9, NODE_KIND_BADGE_CSS_PX * dpr * 1.35),
      );
      const iconColor =
        isFocus || isSelected ? kindTint : "rgba(15, 17, 21, 0.9)";
      drawNodeKindBadge(
        ctx,
        node.kind || "symbol",
        screen.x,
        screen.y,
        radius,
        badgePx,
        iconColor,
      );
    }

    if (inNeighborhood && state.camera.zoom > 0.35) {
      ctx.fillStyle = isFocus ? "#e8ecf5" : withAlpha("#e8ecf5", dimming && !isFocus ? 0.85 : 1);
      ctx.font = `${Math.max(9, 10 * state.camera.zoom)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(node.label, screen.x, screen.y + radius + 12);
    }
  }
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
    nodeColors: new Map(nodes.map((n) => [n.id, nodeColor(n.id)])),
  };
}
