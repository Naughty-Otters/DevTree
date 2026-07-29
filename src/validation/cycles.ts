import type { CycleGroup, HierarchyIndex } from "../analysis/types";
import {
  drillIntoFile,
  drillIntoPackage,
  graphForNavigation,
  rootNavigation,
  type GraphNavigation,
} from "../graph/navigation";

export interface CycleGraphPlan {
  navigation: GraphNavigation;
  nodeIds: string[];
  edgeKeys: string[];
}

function packageLabel(pkg: string): string {
  return pkg === "." ? "(root)" : pkg.split("/").pop() ?? pkg;
}

function packageForEntity(
  hierarchy: HierarchyIndex,
  entityId: string,
  kind: CycleGroup["kind"],
): string {
  if (kind === "package_imports") {
    return entityId;
  }
  if (kind === "file_imports") {
    const file = hierarchy.files.find((f) => f.path === entityId);
    if (file) return file.package;
    const slash = entityId.indexOf("/");
    return slash < 0 ? "." : entityId.slice(0, slash);
  }
  for (const symbols of Object.values(hierarchy.symbols)) {
    const sym = symbols.find((s) => s.id === entityId);
    if (sym) {
      const file = hierarchy.files.find((f) => f.path === sym.file);
      if (file) return file.package;
      const slash = sym.file.indexOf("/");
      return slash < 0 ? "." : sym.file.slice(0, slash);
    }
  }
  return ".";
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

function edgeKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function buildEdgeKeys(path: string[]): string[] {
  if (path.length < 2) return [];
  const keys: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    keys.push(edgeKey(path[i], path[i + 1]));
  }
  const first = path[0];
  const last = path[path.length - 1];
  if (path.length > 2 && first !== last) {
    keys.push(edgeKey(last, first));
  }
  return keys;
}

function uniqueDefined(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function symbolFile(hierarchy: HierarchyIndex, symbolId: string): string | null {
  for (const symbols of Object.values(hierarchy.symbols)) {
    const sym = symbols.find((s) => s.id === symbolId);
    if (sym) return sym.file;
  }
  return null;
}

function navigationLevel(navigation: GraphNavigation): string {
  return navigation.crumbs[navigation.crumbs.length - 1]?.level ?? "packages";
}

function navigationWithContent(
  hierarchy: HierarchyIndex,
  candidates: GraphNavigation[],
): GraphNavigation {
  for (const navigation of candidates) {
    const graph = graphForNavigation(hierarchy, navigation);
    if (graph.nodes.length > 0) return navigation;
  }
  return candidates[0] ?? rootNavigation();
}

function pickFileImportsNavigation(
  hierarchy: HierarchyIndex,
  members: string[],
): GraphNavigation {
  const packages = uniqueDefined(
    members.map((member) => packageForEntity(hierarchy, member, "file_imports")),
  );

  const candidates: GraphNavigation[] = [];
  if (packages.length === 1 && packages[0] !== ".") {
    candidates.push(
      drillIntoPackage(rootNavigation(), packages[0], packageLabel(packages[0])),
    );
  }
  candidates.push(rootNavigation());
  return navigationWithContent(hierarchy, candidates);
}

function pickSymbolNavigation(
  hierarchy: HierarchyIndex,
  members: string[],
  path: string[],
): GraphNavigation {
  const firstSymbol = members[0] ?? path[0] ?? "";
  const firstFile = symbolFile(hierarchy, firstSymbol);
  if (!firstFile) return rootNavigation();

  const file = hierarchy.files.find((f) => f.path === firstFile);
  const pkg = file?.package ?? packageForEntity(hierarchy, firstFile, "file_imports");

  const candidates: GraphNavigation[] = [
    drillIntoFile(
      drillIntoPackage(rootNavigation(), pkg, packageLabel(pkg)),
      firstFile,
      firstFile.split("/").pop() ?? firstFile,
    ),
    drillIntoPackage(rootNavigation(), pkg, packageLabel(pkg)),
    rootNavigation(),
  ];
  return navigationWithContent(hierarchy, candidates);
}

function mapCycleEntity(
  hierarchy: HierarchyIndex,
  cycle: CycleGroup,
  entityId: string,
  navigation: GraphNavigation,
  graphIds: Set<string>,
): string | null {
  const level = navigationLevel(navigation);

  if (cycle.kind === "package_imports") {
    if (graphIds.has(entityId)) return entityId;
    const pkg = packageForEntity(hierarchy, entityId, "package_imports");
    return graphIds.has(pkg) ? pkg : null;
  }

  if (cycle.kind === "symbol_references") {
    if (level === "symbols") {
      return graphIds.has(entityId) ? entityId : null;
    }
    const file = symbolFile(hierarchy, entityId);
    if (level === "packages") {
      if (!file) return null;
      const pkg = packageForEntity(hierarchy, file, "file_imports");
      return graphIds.has(pkg) ? pkg : null;
    }
    if (file) {
      return mapFileToLevelNode(file, graphIds);
    }
    return graphIds.has(entityId) ? entityId : null;
  }

  // file_imports
  if (level === "packages") {
    const pkg = packageForEntity(hierarchy, entityId, "file_imports");
    if (graphIds.has(pkg)) return pkg;
    return mapFileToLevelNode(entityId, graphIds);
  }

  return mapFileToLevelNode(entityId, graphIds);
}

function planForNavigation(
  hierarchy: HierarchyIndex,
  cycle: CycleGroup,
  members: string[],
  path: string[],
  navigation: GraphNavigation,
): CycleGraphPlan {
  const graph = graphForNavigation(hierarchy, navigation);
  const graphIds = new Set(graph.nodes.map((node) => node.id));
  const nodeIds = uniqueDefined(
    members.map((member) => mapCycleEntity(hierarchy, cycle, member, navigation, graphIds)),
  );
  const mappedPath = uniqueDefined(
    path.map((step) => mapCycleEntity(hierarchy, cycle, step, navigation, graphIds)),
  );

  return {
    navigation,
    nodeIds,
    edgeKeys: buildEdgeKeys(mappedPath),
  };
}

export function cycleKindLabel(kind: CycleGroup["kind"]): string {
  switch (kind) {
    case "file_imports":
      return "File imports";
    case "package_imports":
      return "Package imports";
    case "symbol_references":
      return "Symbol references";
    default:
      return kind;
  }
}

function parseCycleLabel(label: string): CycleGroup["kind"] {
  const lower = label.toLowerCase();
  if (lower.includes("package")) return "package_imports";
  if (lower.includes("symbol")) return "symbol_references";
  return "file_imports";
}

/** Use structured backend data when present; otherwise parse legacy affected strings. */
export function cycleGroupsFromValidation(item: {
  rule_id: string;
  cycle_groups?: CycleGroup[];
  affected: string[];
}): CycleGroup[] {
  if (item.cycle_groups?.length) {
    return item.cycle_groups;
  }
  if (item.rule_id !== "circular_dependencies") {
    return [];
  }

  const groups: CycleGroup[] = [];
  for (const raw of item.affected) {
    const trimmed = raw.trim();
    const match = trimmed.match(/^\[([^\]]+)\]\s+(.+)$/);
    if (!match) continue;

    const kind = parseCycleLabel(match[1]);
    const body = match[2];
    if (body.includes("strongly connected group")) {
      const previewMatch = body.match(/:\s*(.+?)\s*…$/);
      const preview = previewMatch
        ? previewMatch[1].split(",").map((part) => part.trim()).filter(Boolean)
        : [];
      groups.push({
        kind,
        nodes: preview,
        path: preview,
        label: trimmed,
      });
      continue;
    }

    const path = body
      .split("→")
      .map((part) => part.trim())
      .filter(Boolean);
    if (path.length === 0) continue;
    groups.push({
      kind,
      nodes: [...new Set(path)],
      path,
      label: trimmed,
    });
  }
  return groups;
}

export function planCycleGraphView(
  hierarchy: HierarchyIndex,
  cycle: CycleGroup,
): CycleGraphPlan {
  const members =
    cycle.nodes.length > 0
      ? cycle.nodes
      : cycle.path.length > 0
        ? cycle.path
        : [];
  const path =
    cycle.path.length >= 2 ? cycle.path : members.length > 0 ? members : [];

  if (cycle.kind === "package_imports") {
    return planForNavigation(
      hierarchy,
      cycle,
      members,
      path,
      rootNavigation(),
    );
  }

  if (cycle.kind === "symbol_references") {
    const navigation = pickSymbolNavigation(hierarchy, members, path);
    return planForNavigation(hierarchy, cycle, members, path, navigation);
  }

  const navigation = pickFileImportsNavigation(hierarchy, members);
  return planForNavigation(hierarchy, cycle, members, path, navigation);
}

export function cycleHighlightFromPlan(plan: CycleGraphPlan): {
  nodeIds: Set<string>;
  edgeKeys: Set<string>;
} {
  return {
    nodeIds: new Set(plan.nodeIds),
    edgeKeys: new Set(plan.edgeKeys),
  };
}
