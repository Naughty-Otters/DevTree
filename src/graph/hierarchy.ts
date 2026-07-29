import type { HierarchyIndex } from "../analysis/types";
import { HIERARCHY_VERSION } from "../analysis/types";
import type { Graph } from "./types";

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return ".";
  return path.slice(0, idx);
}

function topLevelPackage(filePath: string): string {
  const idx = filePath.indexOf("/");
  return idx < 0 ? "." : filePath.slice(0, idx);
}

export function hierarchyFromGraph(graph: Graph): HierarchyIndex {
  const packages = new Set<string>();
  const files = graph.nodes
    .filter((n) => n.kind !== "package" || n.path.includes("."))
    .map((n) => {
      const pkg = topLevelPackage(n.path);
      packages.add(pkg);
      return {
        path: n.path,
        label: n.label,
        loc: n.loc,
        package: pkg,
      };
    });

  if (graph.nodes.some((n) => n.kind === "package")) {
    for (const n of graph.nodes.filter((n) => n.kind === "package")) {
      packages.add(n.path);
    }
  }

  const file_imports: Record<string, string[]> = {};
  for (const edge of graph.edges) {
    if (!file_imports[edge.source]) file_imports[edge.source] = [];
    if (graph.nodes.some((n) => n.path === edge.target && n.kind !== "package")) {
      file_imports[edge.source].push(edge.target);
    }
  }

  const symbols: HierarchyIndex["symbols"] = {};
  for (const file of files) {
    const base = file.label.replace(/\.[^.]+$/, "");
    symbols[file.path] = [
      {
        id: `${file.path}::${base}`,
        label: base,
        kind: "module",
        file: file.path,
        line: 1,
      },
    ];
  }

  return {
    version: HIERARCHY_VERSION,
    files,
    packages: [...packages].sort(),
    file_imports,
    package_edges: computePackageEdges(files, file_imports),
    symbols,
    symbol_edges: [],
  };
}

export function mockHierarchyForFixture(graph: Graph): HierarchyIndex {
  const fileNodes = graph.nodes.filter((n) => n.kind === "module" || n.kind === "file");
  const packages = new Set<string>();
  const files = fileNodes.map((n) => {
    const pkg = topLevelPackage(n.path);
    packages.add(pkg);
    return {
      path: n.path,
      label: n.label,
      loc: n.loc,
      package: pkg,
    };
  });

  const file_imports: Record<string, string[]> = {};
  for (const edge of graph.edges) {
    if (!file_imports[edge.source]) file_imports[edge.source] = [];
    file_imports[edge.source].push(edge.target);
  }

  const symbols: HierarchyIndex["symbols"] = {};
  const symbol_edges: HierarchyIndex["symbol_edges"] = [];
  for (const file of files) {
    const stem = file.label.replace(/\.[^.]+$/, "");
    const mainId = `${file.path}::main`;
    const typeId = `${file.path}::${stem}Types`;
    symbols[file.path] = [
      { id: mainId, label: "main", kind: "function", file: file.path, line: 1 },
      { id: typeId, label: `${stem}Types`, kind: "type", file: file.path, line: 8 },
      {
        id: `${file.path}::helper`,
        label: "helper",
        kind: "function",
        file: file.path,
        line: 20,
      },
    ];
    symbol_edges.push({ source: mainId, target: typeId, kind: "reference" });
  }

  const package_edges = computePackageEdges(files, file_imports);

  return {
    version: HIERARCHY_VERSION,
    files,
    packages: [...packages].sort(),
    file_imports,
    package_edges,
    symbols,
    symbol_edges,
  };
}

function computePackageEdges(
  files: { path: string; package: string }[],
  file_imports: Record<string, string[]>,
): HierarchyIndex["package_edges"] {
  const pkgByFile = new Map(files.map((f) => [f.path, f.package]));
  const edges: HierarchyIndex["package_edges"] = [];
  const seen = new Set<string>();
  for (const [sourceFile, targets] of Object.entries(file_imports)) {
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

export { parentDir, topLevelPackage };
