import type { AnalysisResult, HierarchyIndex } from "../analysis/types";
import { loadAnalysisHierarchyLite } from "../project/api";
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
 * Load hierarchy-lite on demand (files + imports, no symbols).
 * Never called on first paint after analysis — only on graph drill / DSM.
 */
export function loadAnalysisHierarchy(
  result: AnalysisResult | null,
  projectRoot?: string | null,
): Promise<HierarchyIndex | null> {
  if (hierarchyIsHydrated(result?.hierarchy)) {
    return Promise.resolve(result!.hierarchy);
  }
  if (!hierarchyPromise) {
    hierarchyPromise = (async () => {
      if (projectRoot) {
        try {
          const lite = await loadAnalysisHierarchyLite(projectRoot);
          if (hierarchyIsHydrated(lite)) return lite;
        } catch (err) {
          console.warn("Cached hierarchy-lite unavailable", err);
        }
      }
      // Legacy SQLite / pointer fallback.
      return loadPersistedAnalysisHierarchy(projectRoot);
    })();
  }
  return hierarchyPromise;
}
