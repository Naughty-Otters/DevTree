import type { Graph, GraphEdge, GraphNode } from "./types";
import type { HierarchyIndex } from "../analysis/types";
import { HIERARCHY_VERSION } from "../analysis/types";

export type NavLevel = "packages" | "package" | "symbols";

export interface NavCrumb {
  level: NavLevel;
  id: string;
  label: string;
}

export interface GraphNavigation {
  crumbs: NavCrumb[];
  history: NavCrumb[][];
  historyIndex: number;
}

export function rootNavigation(): GraphNavigation {
  const crumbs: NavCrumb[] = [
    { level: "packages", id: ".", label: "Packages" },
  ];
  return { crumbs, history: [crumbs], historyIndex: 0 };
}

export function canGoBack(nav: GraphNavigation): boolean {
  return nav.historyIndex > 0;
}

export function canGoForward(nav: GraphNavigation): boolean {
  return nav.historyIndex < nav.history.length - 1;
}

export function goBack(nav: GraphNavigation): GraphNavigation {
  if (!canGoBack(nav)) return nav;
  const historyIndex = nav.historyIndex - 1;
  return {
    ...nav,
    crumbs: [...nav.history[historyIndex]],
    historyIndex,
  };
}

export function goForward(nav: GraphNavigation): GraphNavigation {
  if (!canGoForward(nav)) return nav;
  const historyIndex = nav.historyIndex + 1;
  return {
    ...nav,
    crumbs: [...nav.history[historyIndex]],
    historyIndex,
  };
}

function pushHistory(nav: GraphNavigation, crumbs: NavCrumb[]): GraphNavigation {
  const trimmed = nav.history.slice(0, nav.historyIndex + 1);
  trimmed.push(crumbs);
  return {
    crumbs,
    history: trimmed,
    historyIndex: trimmed.length - 1,
  };
}

export function navigateTo(nav: GraphNavigation, crumb: NavCrumb): GraphNavigation {
  const idx = nav.crumbs.findIndex((c) => c.level === crumb.level && c.id === crumb.id);
  if (idx >= 0) {
    const crumbs = nav.crumbs.slice(0, idx + 1);
    return pushHistory(nav, crumbs);
  }
  const crumbs = [...nav.crumbs, crumb];
  return pushHistory(nav, crumbs);
}

export function drillIntoPackage(
  nav: GraphNavigation,
  packageId: string,
  label: string,
): GraphNavigation {
  return navigateTo(nav, { level: "package", id: packageId, label });
}

export function drillIntoFile(
  nav: GraphNavigation,
  fileId: string,
  label: string,
): GraphNavigation {
  return navigateTo(nav, { level: "symbols", id: fileId, label });
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return ".";
  return path.slice(0, idx);
}

function packageLabel(pkg: string): string {
  return pkg === "." ? "(root)" : pkg.split("/").pop() ?? pkg;
}

function filesInScope(
  hierarchy: HierarchyIndex,
  packagePath: string,
): HierarchyIndex["files"] {
  if (hierarchy.packages.includes(packagePath)) {
    return hierarchy.files.filter((f) => f.package === packagePath);
  }
  if (packagePath === ".") {
    return hierarchy.files.filter((f) => f.package === ".");
  }
  return hierarchy.files.filter(
    (f) => f.path === packagePath || f.path.startsWith(`${packagePath}/`),
  );
}

function immediateChildPath(packagePath: string, filePath: string): string | null {
  if (packagePath === ".") {
    const slash = filePath.indexOf("/");
    if (slash < 0) return filePath;
    return filePath.slice(0, slash);
  }
  if (!filePath.startsWith(`${packagePath}/`)) return null;
  const rest = filePath.slice(packagePath.length + 1);
  const slash = rest.indexOf("/");
  if (slash < 0) return filePath;
  return `${packagePath}/${rest.slice(0, slash)}`;
}

function mapFileToLevelNode(filePath: string, childIds: Set<string>): string | null {
  if (childIds.has(filePath)) return filePath;

  let best: string | null = null;
  for (const id of childIds) {
    if (filePath.startsWith(`${id}/`)) {
      if (!best || id.length > best.length) best = id;
    }
  }
  return best;
}

function packageContentChildren(
  hierarchy: HierarchyIndex,
  packagePath: string,
): GraphNode[] {
  const scoped = filesInScope(hierarchy, packagePath);
  const nodes = new Map<string, GraphNode>();

  for (const file of scoped) {
    const dir = parentDir(file.path);
    if (dir === packagePath) {
      nodes.set(file.path, {
        id: file.path,
        label: file.label,
        path: file.path,
        loc: file.loc,
        kind: "file",
      });
      continue;
    }

    const subPath = immediateChildPath(packagePath, file.path);
    if (!subPath || subPath === file.path) continue;

    if (!nodes.has(subPath)) {
      const loc = scoped
        .filter((f) => f.path === subPath || f.path.startsWith(`${subPath}/`))
        .reduce((sum, f) => sum + f.loc, 0);
      nodes.set(subPath, {
        id: subPath,
        label: packageLabel(subPath),
        path: subPath,
        loc,
        kind: "package",
      });
    }
  }

  return [...nodes.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function packageContentEdges(
  hierarchy: HierarchyIndex,
  packagePath: string,
  children: GraphNode[],
): GraphEdge[] {
  const childIds = new Set(children.map((c) => c.id));
  const scopedPaths = new Set(filesInScope(hierarchy, packagePath).map((f) => f.path));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const [sourceFile, targets] of Object.entries(hierarchy.file_imports ?? {})) {
    if (!scopedPaths.has(sourceFile)) continue;

    const sourceNode = mapFileToLevelNode(sourceFile, childIds);
    if (!sourceNode) continue;

    for (const target of targets) {
      const targetNode = mapFileToLevelNode(target, childIds);
      if (!targetNode || sourceNode === targetNode) continue;

      const key = `${sourceNode}->${targetNode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: sourceNode, target: targetNode, kind: "import" });
    }
  }

  return edges;
}

function packageContentGraph(hierarchy: HierarchyIndex, packagePath: string): Graph {
  const children = packageContentChildren(hierarchy, packagePath);
  return {
    nodes: children,
    edges: packageContentEdges(hierarchy, packagePath, children),
  };
}

function scopeGraphFromBackend(
  hierarchy: HierarchyIndex,
  packagePath: string,
): Graph | null {
  const scoped = hierarchy.scope_graphs?.[packagePath];
  if (!scoped) return null;
  return {
    nodes: scoped.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      path: n.path,
      loc: n.loc,
      kind: n.kind,
    })),
    edges: scoped.edges.map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
    })),
  };
}

export function autoAdvanceSingleFolder(
  hierarchy: HierarchyIndex,
  nav: GraphNavigation,
): GraphNavigation {
  let current = nav;
  for (let i = 0; i < 8; i++) {
    const crumb = current.crumbs[current.crumbs.length - 1];
    if (crumb.level !== "package") break;

    const graph =
      scopeGraphFromBackend(hierarchy, crumb.id) ??
      packageContentGraph(hierarchy, crumb.id);
    if (graph.edges.length > 0 || graph.nodes.length > 1) break;

    const subfolders = packageContentChildren(hierarchy, crumb.id).filter(
      (n) => n.kind === "package",
    );
    if (subfolders.length !== 1) break;

    current = drillIntoPackage(current, subfolders[0].id, subfolders[0].label);
  }
  return current;
}

export function hasStaleImportIndex(hierarchy: HierarchyIndex): boolean {
  // Only flag truly outdated persisted indexes. Missing/zero imports after a
  // fresh analysis is a resolution gap, not a stale schema — showing
  // "run analysis again" in that case is a false positive.
  const version = hierarchy.version ?? 1;
  return version < HIERARCHY_VERSION;
}

export function graphForNavigation(
  hierarchy: HierarchyIndex,
  nav: GraphNavigation,
): Graph {
  const current = nav.crumbs[nav.crumbs.length - 1];

  if (current.level === "packages") {
    return {
      nodes: hierarchy.packages.map((pkg) => {
        const loc = hierarchy.files
          .filter((f) => f.package === pkg)
          .reduce((sum, f) => sum + f.loc, 0);
        return {
          id: pkg,
          label: packageLabel(pkg),
          path: pkg,
          loc,
          kind: "package",
        };
      }),
      edges: buildPackageEdges(hierarchy),
    };
  }

  if (current.level === "package") {
    return (
      scopeGraphFromBackend(hierarchy, current.id) ??
      packageContentGraph(hierarchy, current.id)
    );
  }

  const symbols = hierarchy.symbols[current.id] ?? [];
  const nodes: GraphNode[] = symbols.map((s) => ({
    id: s.id,
    label: s.label,
    path: s.file,
    loc: 1,
    kind: s.kind,
    line: s.line,
  }));

  const symbolIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = hierarchy.symbol_edges
    .filter((e) => symbolIds.has(e.source) && symbolIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, kind: e.kind }));

  return { nodes, edges };
}

function buildPackageEdges(hierarchy: HierarchyIndex): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const edge of hierarchy.package_edges ?? []) {
    const key = `${edge.source}->${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: edge.source, target: edge.target, kind: edge.kind });
  }

  const pkgByFile = new Map(hierarchy.files.map((f) => [f.path, f.package]));

  for (const [sourceFile, targets] of Object.entries(hierarchy.file_imports)) {
    const sourcePkg = pkgByFile.get(sourceFile);
    if (!sourcePkg) continue;
    for (const target of targets) {
      const targetPkg = pkgByFile.get(target);
      if (!targetPkg || sourcePkg === targetPkg) continue;
      const key = `${sourcePkg}->${targetPkg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: sourcePkg, target: targetPkg, kind: "import" });
    }
  }

  return edges;
}

export function isDrillableNode(node: GraphNode, nav: GraphNavigation): boolean {
  const level = nav.crumbs[nav.crumbs.length - 1].level;
  if (node.kind === "package" && (level === "packages" || level === "package")) {
    return true;
  }
  if (node.kind === "file" && level === "package") {
    return true;
  }
  return false;
}

export function drillTargetForNode(
  node: GraphNode,
  nav: GraphNavigation,
): GraphNavigation | null {
  const level = nav.crumbs[nav.crumbs.length - 1].level;
  if (node.kind === "package") {
    return drillIntoPackage(nav, node.id, node.label);
  }
  if (node.kind === "file" && level === "package") {
    return drillIntoFile(nav, node.id, node.label);
  }
  return null;
}

export function serializeNavigation(nav: GraphNavigation): GraphNavigation {
  return {
    crumbs: [...nav.crumbs],
    history: nav.history.map((h) => [...h]),
    historyIndex: nav.historyIndex,
  };
}
