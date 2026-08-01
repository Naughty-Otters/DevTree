import type { AnalysisResult, HierarchyIndex } from "../analysis/types";
import { loadPersistedAnalysisHierarchy } from "../state/store";

let hierarchyPromise: Promise<HierarchyIndex | null> | null = null;

export function clearHierarchyLoadCache(): void {
  hierarchyPromise = null;
}

function hierarchyIsHydrated(hierarchy: HierarchyIndex | null | undefined): boolean {
  return Boolean(
    hierarchy && (hierarchy.files.length > 0 || hierarchy.packages.length > 0),
  );
}

/**
 * Load persisted hierarchy on demand (separate from lightweight analysis meta).
 * Fresh analysis runs still attach hierarchy directly to the in-memory result.
 */
export function loadAnalysisHierarchy(
  result: AnalysisResult | null,
): Promise<HierarchyIndex | null> {
  if (hierarchyIsHydrated(result?.hierarchy)) {
    return Promise.resolve(result!.hierarchy);
  }
  if (!hierarchyPromise) {
    hierarchyPromise = loadPersistedAnalysisHierarchy();
  }
  return hierarchyPromise;
}
