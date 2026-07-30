/** Design Structure Matrix types and client-side calculator (mirrors Rust `dsm.rs`). */

import type { HierarchyIndex } from "./types";

export const DSM_MAX_ELEMENTS = 150;

export interface DsmElement {
  id: string;
  label: string;
  group?: string;
}

export interface DsmMetrics {
  cycleCount: number;
  nodesInCycles: number;
  upperTriangleDensity: number;
  couplingDensity: number;
  /** MacCormack visibility density (reachability / n²). */
  propagationCost: number;
  /** Absolute MacCormack clustered cost (λ=2). */
  clusteredCost: number;
  /** clusteredCost / (deps * N^λ). */
  clusteredCostNormalized: number;
  busCount: number;
  healthScore: number;
}

export interface DesignViolation {
  ruleId: string;
  from: string;
  to: string;
  message: string;
}

export interface DsmResult {
  level: string;
  scope?: string | null;
  ordering: string;
  elements: DsmElement[];
  /** Row depends on column. */
  matrix: number[][];
  metrics: DsmMetrics;
  cycleNodes: string[];
  busIds?: string[];
  violations?: DesignViolation[];
  capped: boolean;
}

export interface DsmOptions {
  level: "package" | "file" | string;
  scope?: string | null;
  ordering: "partitioned" | "hierarchical" | string;
}

export function defaultDsmOptions(): DsmOptions {
  return { level: "package", scope: null, ordering: "partitioned" };
}

export function healthStatus(
  score: number,
): "healthy" | "fair" | "poor" {
  if (score >= 80) return "healthy";
  if (score >= 50) return "fair";
  return "poor";
}

export function computeDsm(
  hierarchy: HierarchyIndex,
  options: DsmOptions = defaultDsmOptions(),
): DsmResult {
  const level = options.level === "file" ? "file" : "package";
  const ordering =
    options.ordering === "hierarchical" ? "hierarchical" : "partitioned";
  const scope = options.scope ?? null;

  const collected =
    level === "file"
      ? collectFileElements(hierarchy, scope)
      : collectPackageElements(hierarchy, scope);

  const { elements: rawElements, edges, capped } = collected;
  const resultScope =
    level === "file"
      ? scope
      : hierarchy.packages.length > 1 && !scope
        ? null
        : (scope ?? hierarchy.packages[0] ?? ".");

  if (rawElements.length === 0) {
    return emptyResult(level, resultScope, ordering);
  }

  const idSet = new Set(rawElements.map((e) => e.id));
  const weight = new Map<string, number>();
  for (const [src, tgt] of edges) {
    if (src === tgt) continue;
    if (!idSet.has(src) || !idSet.has(tgt)) continue;
    const key = `${src}\0${tgt}`;
    weight.set(key, (weight.get(key) ?? 0) + 1);
  }

  const adj = adjacencyWeighted(weight, idSet);
  const { cycleCount, cycleNodes: cycleNodeSet, sccs } = findSccs(adj);
  const cycleNodes = [...cycleNodeSet].sort();

  let elements =
    ordering === "hierarchical"
      ? [...rawElements].sort((a, b) => {
          const g = (a.group ?? "").localeCompare(b.group ?? "");
          return g !== 0 ? g : a.id.localeCompare(b.id);
        })
      : orderPartitioned(rawElements, sccs, adj);

  const index = new Map(elements.map((e, i) => [e.id, i]));
  const n = elements.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0),
  );
  for (const [key, w] of weight) {
    const [src, tgt] = key.split("\0");
    const r = index.get(src!);
    const c = index.get(tgt!);
    if (r !== undefined && c !== undefined) matrix[r]![c] = w;
  }

  const { metrics, busIds } = computeMetrics(
    matrix,
    cycleCount,
    cycleNodes.length,
    adj,
    elements,
  );

  return {
    level,
    scope: resultScope,
    ordering,
    elements,
    matrix,
    metrics,
    cycleNodes,
    busIds,
    violations: [],
    capped,
  };
}

function emptyMetrics(): DsmMetrics {
  return {
    cycleCount: 0,
    nodesInCycles: 0,
    upperTriangleDensity: 0,
    couplingDensity: 0,
    propagationCost: 0,
    clusteredCost: 0,
    clusteredCostNormalized: 0,
    busCount: 0,
    healthScore: 100,
  };
}

function emptyResult(
  level: string,
  scope: string | null,
  ordering: string,
): DsmResult {
  return {
    level,
    scope,
    ordering,
    elements: [],
    matrix: [],
    metrics: emptyMetrics(),
    cycleNodes: [],
    busIds: [],
    violations: [],
    capped: false,
  };
}

function collectPackageElements(
  hierarchy: HierarchyIndex,
  scope: string | null,
): {
  elements: DsmElement[];
  edges: [string, string][];
  capped: boolean;
} {
  // Multi-package workspace at root → inter-package DSM.
  // Otherwise use scope_graphs (folders/modules), same as graph package drill-down.
  const useWorkspace = hierarchy.packages.length > 1 && !scope;
  if (useWorkspace) {
    const elements: DsmElement[] = hierarchy.packages.map((p) => ({
      id: p,
      label: p === "." ? "(root)" : (p.split("/").pop() ?? p),
    }));
    const edges: [string, string][] = hierarchy.package_edges.map((e) => [
      e.source,
      e.target,
    ]);
    return { elements, edges, capped: false };
  }

  const scopePath = scope ?? hierarchy.packages[0] ?? ".";
  const sg = hierarchy.scope_graphs?.[scopePath];
  if (sg && sg.nodes.length > 0) {
    const elements: DsmElement[] = sg.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      group: scopePath,
    }));
    const edges: [string, string][] = sg.edges.map((e) => [e.source, e.target]);
    return { elements, edges, capped: false };
  }

  return collectModuleChildrenFromFiles(hierarchy, scopePath);
}

function collectModuleChildrenFromFiles(
  hierarchy: HierarchyIndex,
  scopePath: string,
): {
  elements: DsmElement[];
  edges: [string, string][];
  capped: boolean;
} {
  const scoped = hierarchy.files.filter((f) => {
    if (hierarchy.packages.includes(scopePath)) return f.package === scopePath;
    if (scopePath === ".") return f.package === ".";
    return f.path === scopePath || f.path.startsWith(`${scopePath}/`);
  });

  const childMap = new Map<string, DsmElement>();
  for (const file of scoped) {
    const childId = immediateChildUnder(scopePath, file.path);
    if (!childId || childMap.has(childId)) continue;
    const isFile = childId === file.path;
    childMap.set(childId, {
      id: childId,
      label: isFile ? file.label : (childId.split("/").pop() ?? childId),
      group: scopePath,
    });
  }

  const elements = [...childMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const idSet = new Set(elements.map((e) => e.id));
  const edges: [string, string][] = [];
  const seen = new Set<string>();

  for (const [src, tgts] of Object.entries(hierarchy.file_imports)) {
    const srcNode = mapFileToChild(src, scopePath, idSet);
    if (!srcNode) continue;
    for (const t of tgts) {
      const tgtNode = mapFileToChild(t, scopePath, idSet);
      if (!tgtNode || srcNode === tgtNode) continue;
      const key = `${srcNode}\0${tgtNode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([srcNode, tgtNode]);
    }
  }

  return { elements, edges, capped: false };
}

function immediateChildUnder(scopePath: string, filePath: string): string | null {
  if (scopePath === ".") {
    const slash = filePath.indexOf("/");
    if (slash < 0) return null;
    return filePath.slice(0, slash);
  }
  const prefix = `${scopePath}/`;
  if (!filePath.startsWith(prefix)) return null;
  const rest = filePath.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return filePath;
  return `${scopePath}/${rest.slice(0, slash)}`;
}

function mapFileToChild(
  filePath: string,
  scopePath: string,
  childIds: Set<string>,
): string | null {
  if (childIds.has(filePath)) return filePath;
  let best: string | null = null;
  for (const id of childIds) {
    if (filePath.startsWith(`${id}/`)) {
      if (!best || id.length > best.length) best = id;
    }
  }
  if (best) return best;
  const child = immediateChildUnder(scopePath, filePath);
  return child && childIds.has(child) ? child : null;
}

function collectFileElements(
  hierarchy: HierarchyIndex,
  scope: string | null,
): {
  elements: DsmElement[];
  edges: [string, string][];
  capped: boolean;
} {
  let files = [...hierarchy.files];
  if (scope) {
    files = files.filter((f) => f.package === scope);
  }

  let capped = false;
  if (files.length > DSM_MAX_ELEMENTS) {
    capped = true;
    const degree = new Map<string, number>();
    for (const [src, tgts] of Object.entries(hierarchy.file_imports)) {
      degree.set(src, (degree.get(src) ?? 0) + tgts.length);
      for (const t of tgts) {
        degree.set(t, (degree.get(t) ?? 0) + 1);
      }
    }
    files.sort((a, b) => {
      const db = degree.get(b.path) ?? 0;
      const da = degree.get(a.path) ?? 0;
      return db !== da ? db - da : a.path.localeCompare(b.path);
    });
    files = files.slice(0, DSM_MAX_ELEMENTS);
  } else {
    files.sort((a, b) => a.path.localeCompare(b.path));
  }

  const idSet = new Set(files.map((f) => f.path));
  const elements: DsmElement[] = files.map((f) => ({
    id: f.path,
    label: f.label,
    group: f.package,
  }));

  const edges: [string, string][] = [];
  for (const [src, tgts] of Object.entries(hierarchy.file_imports)) {
    if (!idSet.has(src)) continue;
    for (const t of tgts) {
      if (idSet.has(t)) edges.push([src, t]);
    }
  }

  return { elements, edges, capped };
}

function adjacencyWeighted(
  weight: Map<string, number>,
  idSet: Set<string>,
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of idSet) adj.set(id, []);
  for (const key of weight.keys()) {
    const [src, tgt] = key.split("\0");
    if (!src || !tgt) continue;
    const list = adj.get(src) ?? [];
    list.push(tgt);
    adj.set(src, list);
  }
  for (const [k, ns] of adj) {
    ns.sort();
    adj.set(k, [...new Set(ns)]);
  }
  return adj;
}

function findSccs(adj: Map<string, string[]>): {
  cycleCount: number;
  cycleNodes: Set<string>;
  sccs: string[][];
} {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const sccs: string[][] = [];
  let cycleCount = 0;
  const cycleNodes = new Set<string>();

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
        cycleCount += 1;
        for (const n of component) cycleNodes.add(n);
      }
      component.sort();
      sccs.push(component);
    }
  }

  const nodes = [...adj.keys()].sort();
  for (const node of nodes) {
    if (!indices.has(node)) strongconnect(node);
  }

  return { cycleCount, cycleNodes, sccs };
}

function orderPartitioned(
  elements: DsmElement[],
  sccs: string[][],
  adj: Map<string, string[]>,
): DsmElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const sccOf = new Map<string, number>();
  sccs.forEach((comp, i) => {
    for (const n of comp) sccOf.set(n, i);
  });

  const condOut = new Map<number, Set<number>>();
  for (let i = 0; i < sccs.length; i++) condOut.set(i, new Set());

  for (const [src, tgts] of adj) {
    const si = sccOf.get(src);
    if (si === undefined) continue;
    for (const t of tgts) {
      const ti = sccOf.get(t);
      if (ti === undefined || si === ti) continue;
      condOut.get(si)!.add(ti);
    }
  }

  const revOut = new Map<number, number[]>();
  const inDeg = new Map<number, number>();
  for (let i = 0; i < sccs.length; i++) {
    revOut.set(i, []);
    inDeg.set(i, 0);
  }
  for (const [si, tgts] of condOut) {
    for (const ti of tgts) {
      revOut.get(ti)!.push(si);
      inDeg.set(si, (inDeg.get(si) ?? 0) + 1);
    }
  }

  const queue: number[] = [];
  const ready = [...inDeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([i]) => i)
    .sort((a, b) => a - b);
  queue.push(...ready);

  const orderedSccs: number[] = [];
  while (queue.length > 0) {
    const i = queue.shift()!;
    orderedSccs.push(i);
    const nexts = [...(revOut.get(i) ?? [])].sort((a, b) => a - b);
    for (const n of nexts) {
      const d = (inDeg.get(n) ?? 1) - 1;
      inDeg.set(n, d);
      if (d === 0) queue.push(n);
    }
  }
  for (let i = 0; i < sccs.length; i++) {
    if (!orderedSccs.includes(i)) orderedSccs.push(i);
  }

  const out: DsmElement[] = [];
  for (const si of orderedSccs) {
    const comp = [...sccs[si]!].sort((a, b) => {
      const fanA = [...adj.values()].filter((ns) => ns.includes(a)).length;
      const fanB = [...adj.values()].filter((ns) => ns.includes(b)).length;
      return fanB !== fanA ? fanB - fanA : a.localeCompare(b);
    });
    for (const id of comp) {
      const el = byId.get(id);
      if (el) out.push(el);
    }
  }
  return out;
}

const MACCORMACK_LAMBDA = 2;
const BUS_THRESHOLD = 0.1;

function computeMetrics(
  matrix: number[][],
  cycleCount: number,
  nodesInCycles: number,
  adj: Map<string, string[]>,
  elements: DsmElement[],
): { metrics: DsmMetrics; busIds: string[] } {
  const n = matrix.length;
  if (n === 0) {
    return { metrics: emptyMetrics(), busIds: [] };
  }

  const possible = n * (n - 1);
  let upper = 0;
  let upperSlots = 0;
  let coupled = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if ((matrix[i]![j] ?? 0) > 0) coupled += 1;
      if (i < j) {
        upperSlots += 1;
        if ((matrix[i]![j] ?? 0) > 0) upper += 1;
      }
    }
  }

  const upperTriangleDensity = upperSlots > 0 ? upper / upperSlots : 0;
  const couplingDensity = possible > 0 ? coupled / possible : 0;
  const propagationCostVal = visibilityPropagationCost(adj, elements);
  const {
    clusteredCost,
    clusteredCostNormalized,
    busIds,
  } = macCormackClusteredCost(matrix, elements);

  const cyclePenalty =
    (nodesInCycles / n) * 45 + Math.min(cycleCount, 10) * 2;
  const upperPenalty = upperTriangleDensity * 20;
  const propPenalty = propagationCostVal * 15;
  const clusterPenalty = clusteredCostNormalized * 15;
  const couplePenalty = couplingDensity * 5;
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      100 - cyclePenalty - upperPenalty - propPenalty - clusterPenalty - couplePenalty,
    ),
  );

  return {
    metrics: {
      cycleCount,
      nodesInCycles,
      upperTriangleDensity,
      couplingDensity,
      propagationCost: propagationCostVal,
      clusteredCost,
      clusteredCostNormalized,
      busCount: busIds.length,
      healthScore,
    },
    busIds,
  };
}

function visibilityPropagationCost(
  adj: Map<string, string[]>,
  elements: DsmElement[],
): number {
  const n = elements.length;
  if (n === 0) return 0;
  const limit = Math.min(n, 80);
  const ids = elements.slice(0, limit).map((e) => e.id);
  const idSet = new Set(ids);

  let reachablePairs = 0;
  for (const start of ids) {
    const seen = new Set<string>();
    const q = [start];
    seen.add(start);
    while (q.length > 0) {
      const v = q.shift()!;
      for (const w of adj.get(v) ?? []) {
        if (!idSet.has(w) || seen.has(w)) continue;
        seen.add(w);
        q.push(w);
      }
    }
    reachablePairs += seen.size;
  }
  return reachablePairs / (ids.length * ids.length);
}

function macCormackClusteredCost(
  matrix: number[][],
  elements: DsmElement[],
): {
  clusteredCost: number;
  clusteredCostNormalized: number;
  busIds: string[];
} {
  const n = matrix.length;
  if (n === 0) {
    return { clusteredCost: 0, clusteredCostNormalized: 0, busIds: [] };
  }

  const fanIn = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((matrix[i]![j] ?? 0) > 0) fanIn[j]! += 1;
    }
  }
  const threshold = Math.max(2, Math.ceil(n * BUS_THRESHOLD));
  const enableBuses = n >= 10;
  const isBus = fanIn.map((fi) => enableBuses && fi >= threshold);
  const busIds = elements
    .filter((_, j) => isBus[j])
    .map((e) => e.id)
    .sort();

  let clusterOf = Array.from({ length: n }, (_, i) => i);
  const hasGroups = elements.some((e) => e.group != null);
  if (hasGroups) {
    const groupIds = new Map<string, number>();
    let next = 0;
    clusterOf = elements.map((el) => {
      const g = el.group ?? el.id;
      let cid = groupIds.get(g);
      if (cid === undefined) {
        cid = next++;
        groupIds.set(g, cid);
      }
      return cid;
    });
  } else {
    clusterOf = greedyMergeClusters(matrix, isBus);
  }

  const clusterSizes = new Map<number, number>();
  for (const c of clusterOf) {
    clusterSizes.set(c, (clusterSizes.get(c) ?? 0) + 1);
  }

  const nPow = n ** MACCORMACK_LAMBDA;
  let total = 0;
  let depCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || (matrix[i]![j] ?? 0) === 0) continue;
      depCount += 1;
      if (isBus[j]) {
        total += 1;
      } else if (clusterOf[i] === clusterOf[j]) {
        const m = clusterSizes.get(clusterOf[i]!) ?? 1;
        total += m ** MACCORMACK_LAMBDA;
      } else {
        total += nPow;
      }
    }
  }

  const clusteredCostNormalized =
    depCount > 0 && nPow > 0
      ? Math.max(0, Math.min(1, total / (depCount * nPow)))
      : 0;

  return { clusteredCost: total, clusteredCostNormalized, busIds };
}

function greedyMergeClusters(matrix: number[][], isBus: boolean[]): number[] {
  const n = matrix.length;
  const clusterOf = Array.from({ length: n }, (_, i) => i);
  if (n <= 1) return clusterOf;

  let improved = true;
  let guard = 0;
  while (improved && guard < n * n) {
    guard += 1;
    improved = false;
    const base = clusteredCostForAssignment(matrix, isBus, clusterOf);
    let best: { i: number; j: number; after: number } | null = null;
    for (let i = 0; i < n; i++) {
      if (isBus[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (isBus[j] || clusterOf[i] === clusterOf[j]) continue;
        const trial = [...clusterOf];
        const cj = trial[j]!;
        const ci = trial[i]!;
        for (let k = 0; k < n; k++) {
          if (trial[k] === cj) trial[k] = ci;
        }
        const after = clusteredCostForAssignment(matrix, isBus, trial);
        if (after + 1e-9 < base && (best === null || after < best.after)) {
          best = { i, j, after };
        }
      }
    }
    if (best) {
      const cj = clusterOf[best.j]!;
      const ci = clusterOf[best.i]!;
      for (let k = 0; k < n; k++) {
        if (clusterOf[k] === cj) clusterOf[k] = ci;
      }
      improved = true;
    }
  }
  return clusterOf;
}

function clusteredCostForAssignment(
  matrix: number[][],
  isBus: boolean[],
  clusterOf: number[],
): number {
  const n = matrix.length;
  const sizes = new Map<number, number>();
  for (const c of clusterOf) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const nPow = n ** MACCORMACK_LAMBDA;
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || (matrix[i]![j] ?? 0) === 0) continue;
      if (isBus[j]) total += 1;
      else if (clusterOf[i] === clusterOf[j]) {
        total += (sizes.get(clusterOf[i]!) ?? 1) ** MACCORMACK_LAMBDA;
      } else total += nPow;
    }
  }
  return total;
}
