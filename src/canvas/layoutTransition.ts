import type { PositionedNode } from "../wasm-bridge";
import type { Camera, RenderState } from "./renderer";
import { fitCameraToContent } from "./camera";

export interface LayoutTransitionOptions {
  durationMs?: number;
  /** When true, also ease the camera to fit visible content at the end. */
  fitCamera?: boolean;
  canvas?: HTMLCanvasElement;
}

export interface VisibilityTransitionOptions {
  durationMs?: number;
}

let activeAnim = 0;

/** Cancel any in-flight layout / visibility / camera transition. */
export function cancelLayoutTransition(): void {
  activeAnim += 1;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/**
 * Fade nodes out / in toward `nextVisible`.
 * Hiding nodes fade 1→0 then join `hiddenIds`; showing nodes leave `hiddenIds`
 * and fade 0→1. Returns immediately if visibility is unchanged.
 */
export function animateVisibilityTransition(
  state: RenderState,
  nextVisible: Set<string>,
  onFrame: () => void,
  options: VisibilityTransitionOptions = {},
): Promise<void> {
  const durationMs = options.durationMs ?? 280;
  const allIds = state.nodes.map((n) => n.id);
  const currentlyVisible = new Set(
    allIds.filter((id) => !state.hiddenIds.has(id)),
  );

  if (setsEqual(currentlyVisible, nextVisible)) {
    state.nodeAlpha.clear();
    return Promise.resolve();
  }

  const hiding: string[] = [];
  const showing: string[] = [];
  for (const id of currentlyVisible) {
    if (!nextVisible.has(id)) hiding.push(id);
  }
  for (const id of nextVisible) {
    if (!currentlyVisible.has(id)) showing.push(id);
  }

  // Keep hiding nodes drawable; reveal showing nodes at alpha 0.
  for (const id of hiding) {
    state.hiddenIds.delete(id);
    state.nodeAlpha.set(id, 1);
  }
  for (const id of showing) {
    state.hiddenIds.delete(id);
    state.nodeAlpha.set(id, 0);
  }

  const token = ++activeAnim;
  const startTime = performance.now();

  return new Promise((resolve) => {
    function step(now: number) {
      if (token !== activeAnim) {
        resolve();
        return;
      }

      const t = Math.min(1, (now - startTime) / durationMs);
      const ease = easeInOutCubic(t);

      for (const id of hiding) {
        state.nodeAlpha.set(id, 1 - ease);
      }
      for (const id of showing) {
        state.nodeAlpha.set(id, ease);
      }

      onFrame();

      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }

      // Commit final visibility.
      state.hiddenIds = new Set(allIds.filter((id) => !nextVisible.has(id)));
      state.nodeAlpha.clear();
      onFrame();
      resolve();
    }

    requestAnimationFrame(step);
  });
}

/**
 * Ease node positions (and optionally the camera) from the current state
 * toward `targetPositions`. Existing positions are the start; missing start
 * positions snap to the target (new nodes).
 */
export function animateLayoutTransition(
  state: RenderState,
  targetPositions: Map<string, PositionedNode>,
  onFrame: () => void,
  options: LayoutTransitionOptions = {},
): Promise<void> {
  const durationMs = options.durationMs ?? 520;
  const token = ++activeAnim;

  const starts = new Map<string, { x: number; y: number }>();
  for (const [id, pos] of targetPositions) {
    const cur = state.positions.get(id);
    starts.set(id, cur ? { x: cur.x, y: cur.y } : { x: pos.x, y: pos.y });
  }

  // Seed current map so first frame renders from starts.
  for (const [id] of targetPositions) {
    const s = starts.get(id)!;
    state.positions.set(id, { id, x: s.x, y: s.y });
  }

  const startCamera: Camera = { ...state.camera };
  let targetCamera: Camera | null = null;
  if (options.fitCamera && options.canvas) {
    // Peek final camera without mutating mid-animation start.
    for (const [id, pos] of targetPositions) {
      state.positions.set(id, { ...pos });
    }
    fitCameraToContent(state, options.canvas);
    targetCamera = { ...state.camera };
    for (const [id, s] of starts) {
      state.positions.set(id, { id, x: s.x, y: s.y });
    }
    state.camera = { ...startCamera };
  }

  const startTime = performance.now();

  return new Promise((resolve) => {
    function step(now: number) {
      if (token !== activeAnim) {
        resolve();
        return;
      }

      const t = Math.min(1, (now - startTime) / durationMs);
      const ease = easeInOutCubic(t);

      for (const [id, end] of targetPositions) {
        const s = starts.get(id)!;
        state.positions.set(id, {
          id,
          x: s.x + (end.x - s.x) * ease,
          y: s.y + (end.y - s.y) * ease,
        });
      }

      if (targetCamera) {
        state.camera.x = startCamera.x + (targetCamera.x - startCamera.x) * ease;
        state.camera.y = startCamera.y + (targetCamera.y - startCamera.y) * ease;
        state.camera.zoom =
          startCamera.zoom + (targetCamera.zoom - startCamera.zoom) * ease;
      }

      onFrame();

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        for (const [id, end] of targetPositions) {
          state.positions.set(id, { ...end });
        }
        if (targetCamera) {
          state.camera = { ...targetCamera };
        }
        onFrame();
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}
