import type { Camera, RenderState } from "./renderer";

/** Cancel in-flight camera tweens when starting a new one (rapid module clicks). */
let cameraAnimToken = 0;

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
  const token = ++cameraAnimToken;
  const start = { ...state.camera };
  const startTime = performance.now();

  function step(now: number) {
    if (token !== cameraAnimToken) return;
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

export function focusCameraOnNodes(
  state: RenderState,
  canvas: HTMLCanvasElement,
  nodeIds: string[],
  zoom = 2.2,
): void {
  const positions = nodeIds
    .map((id) => state.positions.get(id))
    .filter((pos): pos is NonNullable<typeof pos> => pos != null);
  if (positions.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pos of positions) {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y);
  }

  const pad = 48;
  const contentWidth = Math.max(1, maxX - minX + pad);
  const contentHeight = Math.max(1, maxY - minY + pad);
  const fitZoom = Math.min(
    (canvas.width / contentWidth) * 0.9,
    (canvas.height / contentHeight) * 0.9,
    zoom,
    6,
  );

  state.camera.zoom = fitZoom;
  state.camera.x = -(minX + maxX) / 2;
  state.camera.y = -(minY + maxY) / 2;
  state.selectedId = nodeIds[0] ?? null;
}

export function focusCameraOnNodesAnimated(
  state: RenderState,
  canvas: HTMLCanvasElement,
  nodeIds: string[],
  onFrame: () => void,
  zoom = 2.2,
): void {
  const before = { ...state.camera };
  focusCameraOnNodes(state, canvas, nodeIds, zoom);
  const target = { ...state.camera };
  state.camera = before;
  animateCamera(state, target, onFrame);
}

export function focusCameraOnNodeAnimated(
  state: RenderState,
  canvas: HTMLCanvasElement,
  nodeId: string,
  onFrame: () => void,
  zoom = 2.5,
): void {
  const pos = state.positions.get(nodeId);
  if (!pos) return;

  state.selectedId = nodeId;

  // Large graphs: skip tween — each frame was a full canvas paint and felt like a hang.
  const large = state.nodes.length > 400 || state.edges.length > 1200;
  if (large) {
    cameraAnimToken += 1; // cancel any in-flight tween
    focusCameraOnNode(state, canvas, nodeId, zoom);
    onFrame();
    return;
  }

  animateCamera(
    state,
    { x: -pos.x, y: -pos.y, zoom: Math.min(zoom, 6) },
    onFrame,
  );
}
