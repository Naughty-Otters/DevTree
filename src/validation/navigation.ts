import type { HierarchyIndex, SymbolInfo } from "../analysis/types";
import {
  drillIntoFile,
  drillIntoPackage,
  rootNavigation,
  type GraphNavigation,
} from "../graph/navigation";

function packageLabel(pkg: string): string {
  return pkg === "." ? "(root)" : pkg.split("/").pop() ?? pkg;
}

export interface ValidationNavTarget {
  file: string;
  line?: number;
  symbolId?: string;
}

export function findSymbolAtLine(
  hierarchy: HierarchyIndex,
  filePath: string,
  line: number,
): SymbolInfo | undefined {
  const symbols = hierarchy.symbols[filePath] ?? [];
  const exact = symbols.find((s) => s.line === line);
  if (exact) return exact;

  return symbols
    .filter((s) => s.line <= line)
    .sort((a, b) => b.line - a.line)[0];
}

export function resolveValidationTarget(
  hierarchy: HierarchyIndex,
  file: string,
  line?: number,
): ValidationNavTarget {
  const target: ValidationNavTarget = { file, line };
  if (line != null && line > 0) {
    const sym = findSymbolAtLine(hierarchy, file, line);
    if (sym) {
      target.symbolId = sym.id;
      target.line = sym.line;
    }
  }
  return target;
}

/** Navigate to the package view that contains a file (highlights the file node). */
export function navigationToPackageFile(
  hierarchy: HierarchyIndex,
  filePath: string,
): GraphNavigation {
  const file = hierarchy.files.find((f) => f.path === filePath);
  const pkg = file?.package ?? inferPackageForFile(hierarchy, filePath);
  let nav = rootNavigation();
  nav = drillIntoPackage(nav, pkg, packageLabel(pkg));
  return nav;
}

/** Build graph navigation crumbs to a file's symbol view. */
export function navigationToFile(
  hierarchy: HierarchyIndex,
  filePath: string,
): GraphNavigation {
  const file = hierarchy.files.find((f) => f.path === filePath);
  const pkg = file?.package ?? inferPackageForFile(hierarchy, filePath);
  let nav = rootNavigation();
  nav = drillIntoPackage(nav, pkg, packageLabel(pkg));
  const fileLabel = filePath.split("/").pop() ?? filePath;
  return drillIntoFile(nav, filePath, fileLabel);
}

function inferPackageForFile(
  hierarchy: HierarchyIndex,
  filePath: string,
): string {
  for (const pkg of hierarchy.packages) {
    if (hierarchy.files.some((f) => f.path === filePath && f.package === pkg)) {
      return pkg;
    }
  }
  const slash = filePath.indexOf("/");
  if (slash < 0) return ".";
  return filePath.slice(0, slash);
}
