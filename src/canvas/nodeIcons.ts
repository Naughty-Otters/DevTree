import {
  Box,
  Component,
  FileCode2,
  Folder,
  Hash,
  Hexagon,
  SquareFunction,
  Variable,
} from "lucide";
import type { IconNode } from "lucide";

export type NodeShapeKind =
  | "package"
  | "file"
  | "class"
  | "interface"
  | "function"
  | "enum"
  | "const"
  | "symbol";

/** Fixed size for DOM list badges only (canvas icons scale with node radius). */
export const NODE_KIND_BADGE_CSS_PX = 10;

const SHAPE_META: Record<
  NodeShapeKind,
  { color: string; label: string; icon: IconNode }
> = {
  package: { color: "#dcb757", label: "Package", icon: Folder },
  file: { color: "#7eb8da", label: "File", icon: FileCode2 },
  class: { color: "#c792ea", label: "Class", icon: Box },
  interface: { color: "#82aaff", label: "Interface", icon: Component },
  function: { color: "#c3e88d", label: "Function", icon: SquareFunction },
  enum: { color: "#f78c6c", label: "Enum", icon: Hash },
  const: { color: "#89ddff", label: "Constant", icon: Variable },
  symbol: { color: "#9aa4b8", label: "Symbol", icon: Hexagon },
};

export function classifyNodeKind(kind: string): NodeShapeKind {
  switch (kind) {
    case "package":
    case "folder":
      return "package";
    case "file":
    case "module":
      return "file";
    case "class":
    case "struct":
      return "class";
    case "interface":
    case "trait":
    case "type":
      return "interface";
    case "function":
    case "method":
      return "function";
    case "enum":
      return "enum";
    case "const":
    case "constant":
    case "variable":
      return "const";
    default:
      return "symbol";
  }
}

export function nodeKindColor(kind: string): string {
  return SHAPE_META[classifyNodeKind(kind)].color;
}

export function nodeKindLabel(kind: string): string {
  return SHAPE_META[classifyNodeKind(kind)].label;
}

/** Build the canvas path for a node shape (does not fill/stroke). */
export function pathNodeShape(
  ctx: CanvasRenderingContext2D,
  kind: string,
  cx: number,
  cy: number,
  radius: number,
): void {
  const shape = classifyNodeKind(kind);
  const r = Math.max(4, radius);
  ctx.beginPath();

  switch (shape) {
    case "package": {
      const w = r * 1.45;
      const h = r * 1.05;
      roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, r * 0.22);
      break;
    }
    case "file": {
      const w = r * 1.1;
      const h = r * 1.4;
      roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, r * 0.16);
      break;
    }
    case "class": {
      const s = r * 1.25;
      roundRectPath(ctx, cx - s / 2, cy - s / 2, s, s, r * 0.18);
      break;
    }
    case "interface": {
      const d = r * 1.25;
      ctx.moveTo(cx, cy - d);
      ctx.lineTo(cx + d, cy);
      ctx.lineTo(cx, cy + d);
      ctx.lineTo(cx - d, cy);
      ctx.closePath();
      break;
    }
    case "function": {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    }
    case "enum": {
      polygonPath(ctx, cx, cy, r * 1.15, 6, Math.PI / 6);
      break;
    }
    case "const": {
      const d = r * 1.3;
      ctx.moveTo(cx, cy - d);
      ctx.lineTo(cx + d * 0.95, cy + d * 0.75);
      ctx.lineTo(cx - d * 0.95, cy + d * 0.75);
      ctx.closePath();
      break;
    }
    default: {
      polygonPath(ctx, cx, cy, r * 1.1, 5, -Math.PI / 2);
      break;
    }
  }
}

/**
 * Draw a fixed-size Lucide type icon centered on the node shape.
 * `badgeSizePx` is canvas pixels (CSS px × DPR).
 */
export function drawNodeKindBadge(
  ctx: CanvasRenderingContext2D,
  kind: string,
  cx: number,
  cy: number,
  _radius: number,
  badgeSizePx: number,
  iconColor = "#0f1115",
): void {
  const meta = SHAPE_META[classifyNodeKind(kind)];
  const size = badgeSizePx;

  ctx.save();
  drawLucideIcon(
    ctx,
    meta.icon,
    cx - size / 2,
    cy - size / 2,
    size,
    iconColor,
  );
  ctx.restore();
}

function drawLucideIcon(
  ctx: CanvasRenderingContext2D,
  icon: IconNode,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = "transparent";
  // Keep stroke weight readable at both small and large icon sizes.
  ctx.lineWidth = size < 14 ? 2.35 : size < 22 ? 2.1 : 1.9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const node of icon) {
    const [tag, attrs] = node as [string, Record<string, string>];
    if (tag === "path" && attrs.d) {
      ctx.stroke(new Path2D(attrs.d));
    } else if (tag === "circle") {
      const cx = Number(attrs.cx ?? 0);
      const cy = Number(attrs.cy ?? 0);
      const r = Number(attrs.r ?? 0);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tag === "line") {
      ctx.beginPath();
      ctx.moveTo(Number(attrs.x1 ?? 0), Number(attrs.y1 ?? 0));
      ctx.lineTo(Number(attrs.x2 ?? 0), Number(attrs.y2 ?? 0));
      ctx.stroke();
    } else if (tag === "polyline" && attrs.points) {
      const pts = attrs.points.trim().split(/[\s,]+/).map(Number);
      if (pts.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) {
          ctx.lineTo(pts[i], pts[i + 1]);
        }
        ctx.stroke();
      }
    } else if (tag === "rect") {
      const rx = Number(attrs.x ?? 0);
      const ry = Number(attrs.y ?? 0);
      const rw = Number(attrs.width ?? 0);
      const rh = Number(attrs.height ?? 0);
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }
  ctx.restore();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const rr = Math.min(radius, w / 2, h / 2);
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function polygonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): void {
  for (let i = 0; i < sides; i++) {
    const a = rotation + (Math.PI * 2 * i) / sides;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** DOM badge: shape with a centered Lucide type icon. */
export function createNodeKindShape(kind: string, size = 18): HTMLElement {
  const shapeKind = classifyNodeKind(kind);
  const meta = SHAPE_META[shapeKind];
  const wrap = document.createElement("span");
  wrap.className = "node-kind-badge";
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.classList.add("node-kind-shape");
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("fill", meta.color);
  el.setAttribute("stroke", "rgba(0,0,0,0.35)");
  el.setAttribute("stroke-width", "0.8");
  el.setAttribute("d", svgPathForShape(shapeKind));
  svg.appendChild(el);
  wrap.appendChild(svg);

  const iconSize = Math.round(size * 0.55);
  const iconSvg = lucideToSvg(meta.icon, iconSize, "#0f1115");
  iconSvg.classList.add("node-kind-badge-icon");
  wrap.appendChild(iconSvg);
  return wrap;
}

export function createNodeKindShapeWrap(kind: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "tree-icon-wrap";
  wrap.title = nodeKindLabel(kind);
  wrap.appendChild(createNodeKindShape(kind, 18));
  return wrap;
}

function lucideToSvg(icon: IconNode, size: number, color: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", color);
  svg.setAttribute("stroke-width", "2.25");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const node of icon) {
    const [tag, attrs] = node as [string, Record<string, string>];
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
    svg.appendChild(el);
  }
  return svg;
}

function svgPathForShape(shape: NodeShapeKind): string {
  switch (shape) {
    case "package":
      return "M1.5 4.2h11v6.6c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2V4.2zm1.2-1.8h4.2l1 1.2H12c.3 0 .5.2.5.5v.1H1.5V3c0-.4.3-.6.7-.6h.5z";
    case "file":
      return "M3.2 1.5h5.2L11 4.2v8.3c0 .6-.5 1-1 1H3.2c-.6 0-1-.4-1-1V2.5c0-.6.4-1 1-1zm5 .5v2.2H11z";
    case "class":
      return "M2.5 2.5h9v9h-9z";
    case "interface":
      return "M7 1.2L12.8 7 7 12.8 1.2 7z";
    case "function":
      return "M7 1.4a5.6 5.6 0 1 1 0 11.2A5.6 5.6 0 0 1 7 1.4z";
    case "enum":
      return "M7 1.3l4.6 2.65v5.3L7 12.0 2.4 9.25v-5.3z";
    case "const":
      return "M7 1.5l5.4 10.2H1.6z";
    default:
      return "M7 1.2l3.4 2.45 1.3 4.05-2.7 3.25H5l-2.7-3.25 1.3-4.05z";
  }
}
