import init, { compute_layout } from "./wasm/devtree_core.js";
import type { Graph } from "./graph/types";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

let initialized: Promise<unknown> | null = null;

function ensureInit(): Promise<unknown> {
  if (!initialized) {
    initialized = init();
  }
  return initialized;
}

export async function computeLayout(graph: Graph): Promise<PositionedNode[]> {
  await ensureInit();
  const json = compute_layout(JSON.stringify(graph));
  return JSON.parse(json) as PositionedNode[];
}
