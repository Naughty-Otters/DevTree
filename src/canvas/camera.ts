import type { Camera, RenderState } from "./renderer";

export function fitCameraToContent(
  state: RenderState,
  canvas: HTMLCanvasElement,
  padding = 0.92,
): void {
  const visible = state.nodes.filter((n) => !state.hiddenIds.has(n.id));
  if (visible.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of visible) {
    const p = state.positions.get(node.id);
    if (!p) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const nodePad = 18;
  const contentWidth = Math.max(1, maxX - minX + nodePad * 2);
  const contentHeight = Math.max(1, maxY - minY + nodePad * 2);

  state.camera.zoom = Math.min(
    (canvas.width / contentWidth) * padding,
    (canvas.height / contentHeight) * padding,
    6,
  );
  state.camera.x = -(minX + maxX) / 2;
  state.camera.y = -(minY + maxY) / 2;
}

export function focusCameraOnNode(
  state: RenderState,
  _canvas: HTMLCanvasElement,
  nodeId: string,
  zoom = 2.5,
): void {
  const pos = state.positions.get(nodeId);
  if (!pos) return;

  state.camera.x = -pos.x;
  state.camera.y = -pos.y;
  state.camera.zoom = Math.min(zoom, 6);
  state.selectedId = nodeId;
}

export function animateCamera(
  state: RenderState,
  target: Camera,
  onFrame: () => void,
  durationMs = 300,
): void {
  const start = { ...state.camera };
  const startTime = performance.now();

  function step(now: number) {
    const t = Math.min(1, (now - startTime) / durationMs);
    const ease = 1 - Math.pow(1 - t, 3);
    state.camera.x = start.x + (target.x - start.x) * ease;
    state.camera.y = start.y + (target.y - start.y) * ease;
    state.camera.zoom = start.zoom + (target.zoom - start.zoom) * ease;
    onFrame();
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

export function focusCameraOnNodeAnimated(
  state: RenderState,
  _canvas: HTMLCanvasElement,
  nodeId: string,
  onFrame: () => void,
  zoom = 2.5,
): void {
  const pos = state.positions.get(nodeId);
  if (!pos) return;

  state.selectedId = nodeId;
  animateCamera(
    state,
    { x: -pos.x, y: -pos.y, zoom: Math.min(zoom, 6) },
    onFrame,
  );
}
