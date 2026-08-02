import init, {
  analyze_source_metrics,
  compute_layout,
} from "./wasm/devtree_core.js";
import type { Graph } from "./graph/types";
import type { FileSourceMetrics } from "./analysis/codeQualityMetrics";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

/** Graph layout algorithms for the modularization view. */
export type LayoutMode =
  | "organic"
  | "direct"
  | "hierarchical"
  | "circular"
  | "radial"
  | "tree"
  | "cluster";

/** Top-level layout families shown in the primary dropdown. */
export type LayoutFamily =
  | "organic"
  | "dag"
  | "circular"
  | "radial"
  | "tree"
  | "cluster";

/** DAG / Lines style: Direct (L→R) or Hierarchical (T→B). */
export type DagStyle = "direct" | "hierarchical";

export const LAYOUT_FAMILIES: {
  value: LayoutFamily;
  label: string;
  hint: string;
}[] = [
  {
    value: "organic",
    label: "Organic",
    hint: "Force-directed (d3-force style) — natural clusters",
  },
  {
    value: "cluster",
    label: "Cluster",
    hint: "Group densely linked modules; separate groups linked by a single bridge",
  },
  {
    value: "dag",
    label: "DAG / Lines",
    hint: "Directed layered flow — Direct or Hierarchical",
  },
  {
    value: "circular",
    label: "Circular",
    hint: "Nodes on a ring",
  },
  {
    value: "radial",
    label: "Radial",
    hint: "Concentric rings from a root",
  },
  {
    value: "tree",
    label: "Tree",
    hint: "Spanning tree from a root",
  },
];

export const DAG_STYLES: { value: DagStyle; label: string; hint: string }[] = [
  {
    value: "direct",
    label: "Direct",
    hint: "Left-to-right dependency flow",
  },
  {
    value: "hierarchical",
    label: "Hierarchical",
    hint: "Top-to-bottom layered DAG",
  },
];

/** @deprecated Use LAYOUT_FAMILIES + DAG_STYLES; kept for tests/back-compat listings. */
export const LAYOUT_MODES: { value: LayoutMode; label: string; hint: string }[] =
  [
    ...LAYOUT_FAMILIES.filter((f) => f.value !== "dag").map((f) => ({
      value: f.value as LayoutMode,
      label: f.label,
      hint: f.hint,
    })),
    {
      value: "direct",
      label: "Direct",
      hint: "Left-to-right DAG — dependency flow",
    },
    {
      value: "hierarchical",
      label: "Hierarchical",
      hint: "Top-to-bottom layered DAG",
    },
  ];

export function familyFromLayoutMode(mode: LayoutMode): LayoutFamily {
  if (mode === "direct" || mode === "hierarchical") return "dag";
  return mode;
}

export function dagStyleFromLayoutMode(mode: LayoutMode): DagStyle {
  return mode === "hierarchical" ? "hierarchical" : "direct";
}

export function layoutModeFromFamily(
  family: LayoutFamily,
  dagStyle: DagStyle = "direct",
): LayoutMode {
  if (family === "dag") return dagStyle;
  return family;
}

export function parseLayoutMode(value: unknown): LayoutMode {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    s === "hierarchical" ||
    s === "direct" ||
    s === "circular" ||
    s === "radial" ||
    s === "tree" ||
    s === "cluster" ||
    s === "organic"
  ) {
    return s;
  }
  if (s === "dag" || s === "lines" || s === "dag-direct") return "direct";
  if (s === "dag-hierarchical") return "hierarchical";
  return "organic";
}

let initialized: Promise<unknown> | null = null;

function ensureInit(): Promise<unknown> {
  if (!initialized) {
    initialized = init();
  }
  return initialized;
}

export async function computeLayout(
  graph: Graph,
  mode: LayoutMode = "organic",
): Promise<PositionedNode[]> {
  await ensureInit();
  const json = compute_layout(JSON.stringify(graph), mode);
  return JSON.parse(json) as PositionedNode[];
}

/** WASM classic source metrics (fallback / browser). Prefer precomputed analysis.quality. */
export async function analyzeSourceMetricsWasm(
  source: string,
  loc = 0,
): Promise<FileSourceMetrics> {
  await ensureInit();
  const json = analyze_source_metrics(source, loc);
  return JSON.parse(json) as FileSourceMetrics;
}
