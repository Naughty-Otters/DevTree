import init, {
  analyze_source_metrics,
  compute_layout,
} from "./wasm/devtree_core.js";
import type { Graph } from "./graph/types";
import type { FileSourceMetrics } from "./analysis/codeQualityMetrics";
import { t } from "./i18n";

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
    get label() {
      return t("layout.organic");
    },
    get hint() {
      return t("layout.organicHint");
    },
  },
  {
    value: "cluster",
    get label() {
      return t("layout.cluster");
    },
    get hint() {
      return t("layout.clusterHint");
    },
  },
  {
    value: "dag",
    get label() {
      return t("layout.dag");
    },
    get hint() {
      return t("layout.dagHint");
    },
  },
  {
    value: "circular",
    get label() {
      return t("layout.circular");
    },
    get hint() {
      return t("layout.circularHint");
    },
  },
  {
    value: "radial",
    get label() {
      return t("layout.radial");
    },
    get hint() {
      return t("layout.radialHint");
    },
  },
  {
    value: "tree",
    get label() {
      return t("layout.tree");
    },
    get hint() {
      return t("layout.treeHint");
    },
  },
];

export const DAG_STYLES: { value: DagStyle; label: string; hint: string }[] = [
  {
    value: "direct",
    get label() {
      return t("layout.direct");
    },
    get hint() {
      return t("layout.directHint");
    },
  },
  {
    value: "hierarchical",
    get label() {
      return t("layout.hierarchical");
    },
    get hint() {
      return t("layout.hierarchicalHint");
    },
  },
];

/** @deprecated Use LAYOUT_FAMILIES + DAG_STYLES; kept for tests/back-compat listings. */
export const LAYOUT_MODES: { value: LayoutMode; label: string; hint: string }[] =
  [
    ...LAYOUT_FAMILIES.filter((f) => f.value !== "dag").map((f) => ({
      value: f.value as LayoutMode,
      get label() {
        return f.label;
      },
      get hint() {
        return f.hint;
      },
    })),
    {
      value: "direct",
      get label() {
        return t("layout.direct");
      },
      get hint() {
        return t("layout.directModeHint");
      },
    },
    {
      value: "hierarchical",
      get label() {
        return t("layout.hierarchical");
      },
      get hint() {
        return t("layout.hierarchicalHint");
      },
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
