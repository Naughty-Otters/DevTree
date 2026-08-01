import type { AnalysisResult, QualityIndex } from "../analysis/types";
import { loadPersistedAnalysisQuality } from "../state/store";

let qualityPromise: Promise<QualityIndex | null> | null = null;

export function clearQualityLoadCache(): void {
  qualityPromise = null;
}

function qualityIsHydrated(quality: QualityIndex | null | undefined): boolean {
  if (!quality) return false;
  return (
    Object.keys(quality.files).length > 0 ||
    Object.keys(quality.packages).length > 0
  );
}

/**
 * Load persisted quality index on demand (separate from lightweight analysis meta).
 * Fresh analysis runs still attach quality directly to the in-memory result.
 */
export function loadAnalysisQuality(
  result: AnalysisResult | null,
): Promise<QualityIndex | null> {
  if (qualityIsHydrated(result?.quality)) {
    return Promise.resolve(result!.quality!);
  }
  if (!qualityPromise) {
    qualityPromise = loadPersistedAnalysisQuality();
  }
  return qualityPromise;
}
