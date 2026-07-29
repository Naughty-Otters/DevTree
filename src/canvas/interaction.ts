import type { RenderState } from "./renderer";
import { hitTest, screenToWorld } from "./renderer";

const DRAG_THRESHOLD = 4;

export interface InteractionCallbacks {
  onChange: () => void;
  onSelect: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  /** Single click (no drag): open details / clear selection on empty space. */
  onNodeClick?: (id: string | null, clientX: number, clientY: number) => void;
  /** Double click a node: drill into the next hierarchy level. */
  onNodeDoubleClick?: (id: string, clientX: number, clientY: number) => void;
}

export function attachInteraction(
  canvas: HTMLCanvasElement,
  getState: () => RenderState | null,
  callbacks: InteractionCallbacks,
) {
  let pointerDown = false;
  let panning = false;
  let draggingNodeId: string | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let moved = false;

  canvas.addEventListener(
    "wheel",
    (e) => {
      const state = getState();
      if (!state) return;
      e.preventDefault();
      const zoomFactor = Math.exp(-e.deltaY * 0.001);
      state.camera.zoom = Math.min(4, Math.max(0.1, state.camera.zoom * zoomFactor));
      callbacks.onChange();
    },
    { passive: false },
  );

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const state = getState();
    if (!state) return;

    pointerDown = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;

    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const hit = hitTest(state, canvas, sx, sy);

    if (hit) {
      draggingNodeId = hit;
      const pos = state.positions.get(hit);
      if (pos) {
        const world = screenToWorld(state.camera, canvas, sx, sy);
        dragOffsetX = world.x - pos.x;
        dragOffsetY = world.y - pos.y;
      }
      canvas.style.cursor = "grabbing";
    } else {
      panning = true;
      canvas.style.cursor = "grabbing";
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (!pointerDown) return;
    const state = getState();

    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    const didMove = moved || Math.hypot(dx, dy) >= DRAG_THRESHOLD;

    if (!didMove && state) {
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const clicked = hitTest(state, canvas, sx, sy);
      state.selectedId = clicked;
      callbacks.onSelect(clicked);
      callbacks.onNodeClick?.(clicked, e.clientX, e.clientY);
      callbacks.onChange();
    }

    pointerDown = false;
    panning = false;
    draggingNodeId = null;
    canvas.style.cursor = state?.hoveredId ? "pointer" : "default";
  });

  canvas.addEventListener("dblclick", (e) => {
    if (e.button !== 0) return;
    const state = getState();
    if (!state) return;

    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const hit = hitTest(state, canvas, sx, sy);
    if (!hit) return;

    e.preventDefault();
    state.selectedId = hit;
    callbacks.onSelect(hit);
    callbacks.onNodeDoubleClick?.(hit, e.clientX, e.clientY);
    callbacks.onChange();
  });

  canvas.addEventListener("mouseleave", () => {
    const state = getState();
    if (state) state.hoveredId = null;
    callbacks.onHover?.(null);
    callbacks.onChange();
    if (!pointerDown) {
      canvas.style.cursor = "default";
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    const state = getState();
    if (!state) return;

    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (pointerDown) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(e.clientX - downX) >= DRAG_THRESHOLD || Math.abs(e.clientY - downY) >= DRAG_THRESHOLD) {
        moved = true;
      }
      lastX = e.clientX;
      lastY = e.clientY;

      if (draggingNodeId) {
        const pos = state.positions.get(draggingNodeId);
        if (pos) {
          const world = screenToWorld(state.camera, canvas, sx, sy);
          pos.x = world.x - dragOffsetX;
          pos.y = world.y - dragOffsetY;
          callbacks.onChange();
        }
        return;
      }

      if (panning) {
        state.camera.x += dx / state.camera.zoom;
        state.camera.y += dy / state.camera.zoom;
        callbacks.onChange();
      }
      return;
    }

    const hovered = hitTest(state, canvas, sx, sy);
    if (hovered !== state.hoveredId) {
      state.hoveredId = hovered;
      canvas.style.cursor = hovered ? "grab" : "default";
      callbacks.onHover?.(hovered);
      callbacks.onChange();
    }
  });
}
