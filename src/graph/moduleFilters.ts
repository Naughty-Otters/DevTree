import { t } from "../i18n";
import type { GraphEdge, GraphNode } from "./types";

/** Which module roles are shown on the graph / modules list. */
export interface ModuleFilterFlags {
  /** One-way: depends on others or is depended on, but not both. */
  withDependencies: boolean;
  /** No incoming or outgoing edges. */
  independent: boolean;
  /** Part of a dependency cycle (SCC). */
  circular: boolean;
  /** Both incoming and outgoing edges (dependency hub). */
  hub: boolean;
}

export const DEFAULT_MODULE_FILTERS: ModuleFilterFlags = {
  withDependencies: true,
  independent: true,
  circular: true,
  hub: true,
};

export type ModuleRole = "independent" | "withDependencies" | "hub" | "circular";

export interface ModuleClassification {
  inDegree: number;
  outDegree: number;
  /** In a cycle (SCC size > 1 or self-loop). */
  circular: boolean;
  /** Primary degree role (circular is tracked separately and may overlap). */
  role: "independent" | "withDependencies" | "hub";
}

export function parseModuleFilters(value: unknown): ModuleFilterFlags {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_MODULE_FILTERS };
  }
  const v = value as Record<string, unknown>;
  return {
    withDependencies: v.withDependencies !== false,
    independent: v.independent !== false,
    circular: v.circular !== false,
    hub: v.hub !== false,
  };
}

export function allModuleFiltersEnabled(flags: ModuleFilterFlags): boolean {
  return (
    flags.withDependencies &&
    flags.independent &&
    flags.circular &&
    flags.hub
  );
}

function degrees(
  nodeIds: Iterable<string>,
  edges: GraphEdge[],
): { inDegree: Map<string, number>; outDegree: Map<string, number> } {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    outDegree.set(id, 0);
  }
  for (const edge of edges) {
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) continue;
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  return { inDegree, outDegree };
}

/** Tarjan SCC — nodes in multi-node components or with self-loops. */
export function circularNodeIds(
  nodeIds: string[],
  edges: GraphEdge[],
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const edge of edges) {
    if (!adj.has(edge.source) || !adj.has(edge.target)) continue;
    adj.get(edge.source)!.push(edge.target);
  }

  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const cyclic = new Set<string>();

  function strongconnect(v: string): void {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      const isCyclic =
        component.length > 1 ||
        (component[0] !== undefined &&
          (adj.get(component[0]) ?? []).includes(component[0]));
      if (isCyclic) {
        for (const n of component) cyclic.add(n);
      }
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) strongconnect(id);
  }
  return cyclic;
}

export function classifyModules(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, ModuleClassification> {
  const ids = nodes.map((n) => n.id);
  const { inDegree, outDegree } = degrees(ids, edges);
  const circular = circularNodeIds(ids, edges);
  const out = new Map<string, ModuleClassification>();

  for (const id of ids) {
    const inn = inDegree.get(id) ?? 0;
    const outn = outDegree.get(id) ?? 0;
    let role: ModuleClassification["role"];
    if (inn === 0 && outn === 0) role = "independent";
    else if (inn > 0 && outn > 0) role = "hub";
    else role = "withDependencies";

    out.set(id, {
      inDegree: inn,
      outDegree: outn,
      circular: circular.has(id),
      role,
    });
  }
  return out;
}

/**
 * A node is visible when it matches any enabled filter.
 * `withDependencies` includes one-way dependents and hubs (any connection).
 * `hub` can still show hubs alone when `withDependencies` is off.
 * `circular` may overlap and can keep cycle members visible when their
 * degree-role toggle is off.
 */
export function nodeMatchesFilters(
  c: ModuleClassification,
  flags: ModuleFilterFlags,
): boolean {
  if (flags.independent && c.role === "independent") return true;
  if (
    flags.withDependencies &&
    (c.role === "withDependencies" || c.role === "hub")
  ) {
    return true;
  }
  if (flags.hub && c.role === "hub") return true;
  if (flags.circular && c.circular) return true;
  return false;
}

export function visibleIdsForFilters(
  nodes: GraphNode[],
  edges: GraphEdge[],
  flags: ModuleFilterFlags,
): Set<string> {
  const classified = classifyModules(nodes, edges);
  const visible = new Set<string>();
  for (const node of nodes) {
    const c = classified.get(node.id);
    if (c && nodeMatchesFilters(c, flags)) visible.add(node.id);
  }
  return visible;
}

export const MODULE_FILTER_OPTIONS: {
  key: keyof ModuleFilterFlags;
  label: string;
  hint: string;
}[] = [
  {
    key: "withDependencies",
    get label() {
      return t("filter.withDependencies");
    },
    get hint() {
      return t("filter.withDependenciesHint");
    },
  },
  {
    key: "independent",
    get label() {
      return t("filter.independent");
    },
    get hint() {
      return t("filter.independentHint");
    },
  },
  {
    key: "circular",
    get label() {
      return t("filter.circular");
    },
    get hint() {
      return t("filter.circularHint");
    },
  },
  {
    key: "hub",
    get label() {
      return t("filter.hubs");
    },
    get hint() {
      return t("filter.hubsHint");
    },
  },
];
