import type { GraphEdge, GraphNode } from "../graph/types";
import { nodeColor } from "../canvas/colors";

let popupEl: HTMLElement | null = null;
let anchorEl: HTMLElement | null = null;
let openNodeId: string | null = null;
let onCloseHandler: (() => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

function ensureAnchor(): HTMLElement {
  if (!anchorEl) {
    anchorEl = document.querySelector<HTMLElement>("#center-content")!;
  }
  return anchorEl;
}

function ensurePopup(): HTMLElement {
  if (!popupEl) {
    popupEl = document.createElement("div");
    popupEl.className = "graph-popup hidden";
    popupEl.addEventListener("click", (e) => e.stopPropagation());
    ensureAnchor().appendChild(popupEl);
  }
  return popupEl;
}

function relatedModules(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): { dependsOn: GraphNode[]; usedBy: GraphNode[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dependsOn: GraphNode[] = [];
  const usedBy: GraphNode[] = [];

  for (const edge of edges) {
    if (edge.source === nodeId) {
      const target = byId.get(edge.target);
      if (target) dependsOn.push(target);
    }
    if (edge.target === nodeId) {
      const source = byId.get(edge.source);
      if (source) usedBy.push(source);
    }
  }

  const byLabel = (a: GraphNode, b: GraphNode) => a.label.localeCompare(b.label);
  dependsOn.sort(byLabel);
  usedBy.sort(byLabel);
  return { dependsOn, usedBy };
}

function renderModuleList(items: GraphNode[]): string {
  if (items.length === 0) {
    return `<li class="graph-popup-empty">None</li>`;
  }
  return items
    .map((n) => {
      const color = nodeColor(n.id);
      return `<li class="graph-popup-dep-item">
        <span class="graph-popup-dot" style="background:${color}"></span>
        <span class="graph-popup-dep-name" title="${escapeHtml(n.path)}">${escapeHtml(n.label)}</span>
      </li>`;
    })
    .join("");
}

export function showGraphPopup(
  node: GraphNode,
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientX: number,
  clientY: number,
  onClose?: () => void,
): void {
  const popup = ensurePopup();
  const { dependsOn, usedBy } = relatedModules(node.id, nodes, edges);
  const color = nodeColor(node.id);

  popup.innerHTML = `
    <div class="graph-popup-header">
      <div class="graph-popup-title">
        <span class="graph-popup-dot" style="background:${color}"></span>
        <span class="graph-popup-name">${escapeHtml(node.label)}</span>
      </div>
      <button type="button" class="graph-popup-close" aria-label="Close">×</button>
    </div>
    <div class="graph-popup-body">
      <div class="graph-popup-row"><span class="graph-popup-label">Path</span><span class="graph-popup-value" title="${escapeHtml(node.path)}">${escapeHtml(node.path)}</span></div>
      <div class="graph-popup-row"><span class="graph-popup-label">Lines</span><span class="graph-popup-value">${node.loc}</span></div>
      <div class="graph-popup-row"><span class="graph-popup-label">Kind</span><span class="graph-popup-value">${escapeHtml(node.kind || "module")}</span></div>
      <div class="graph-popup-section">
        <div class="graph-popup-section-title">Depends on <span class="graph-popup-count">${dependsOn.length}</span></div>
        <ul class="graph-popup-deps">${renderModuleList(dependsOn)}</ul>
      </div>
      <div class="graph-popup-section">
        <div class="graph-popup-section-title">Used by <span class="graph-popup-count">${usedBy.length}</span></div>
        <ul class="graph-popup-deps">${renderModuleList(usedBy)}</ul>
      </div>
    </div>
  `;

  popup.querySelector<HTMLButtonElement>(".graph-popup-close")!.addEventListener("click", () => {
    hideGraphPopup();
  });

  openNodeId = node.id;
  onCloseHandler = onClose ?? null;
  popup.classList.remove("hidden");

  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
  }
  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") hideGraphPopup();
  };
  document.addEventListener("keydown", escapeHandler);

  requestAnimationFrame(() => positionPopup(popup, clientX, clientY));
}

export function hideGraphPopup(): void {
  popupEl?.classList.add("hidden");
  openNodeId = null;
  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
  onCloseHandler?.();
  onCloseHandler = null;
}

export function toggleGraphPopup(
  node: GraphNode,
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientX: number,
  clientY: number,
  onClose?: () => void,
): void {
  if (openNodeId === node.id && popupEl && !popupEl.classList.contains("hidden")) {
    hideGraphPopup();
    return;
  }
  showGraphPopup(node, nodes, edges, clientX, clientY, onClose);
}

export function isGraphPopupOpen(): boolean {
  return openNodeId != null && popupEl != null && !popupEl.classList.contains("hidden");
}

function positionPopup(popup: HTMLElement, clientX: number, clientY: number): void {
  const container = ensureAnchor();
  const containerRect = container.getBoundingClientRect();
  const offset = 12;
  let left = clientX - containerRect.left + offset;
  let top = clientY - containerRect.top + offset;

  const popupRect = popup.getBoundingClientRect();
  const maxLeft = containerRect.width - popupRect.width - 8;
  const maxTop = containerRect.height - popupRect.height - 8;

  left = Math.max(8, Math.min(left, maxLeft));
  top = Math.max(8, Math.min(top, maxTop));

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
