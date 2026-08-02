import type { AnalysisResult, QualityIndex } from "../analysis/types";
import { loadAnalysisQualityFiles } from "../project/api";
import { loadPersistedAnalysisQuality } from "../state/store";

let qualityPromise: Promise<QualityIndex | null> | null = null;
let qualityFilesPromise: Promise<QualityIndex | null> | null = null;

export function clearQualityLoadCache(): void {
  qualityPromise = null;
  qualityFilesPromise = null;
}

function qualityPackagesHydrated(quality: QualityIndex | null | undefined): boolean {
  if (!quality) return false;
  return Object.keys(quality.packages).length > 0;
}

function qualityFilesHydrated(quality: QualityIndex | null | undefined): boolean {
  if (!quality) return false;
  return Object.keys(quality.files).length > 0;
}

function qualityInMemory(quality: QualityIndex | null | undefined): boolean {
  return qualityPackagesHydrated(quality) || qualityFilesHydrated(quality);
}

/**
 * Prefer in-memory quality; otherwise load package rollups from persistence
 * (files stay empty until loadAnalysisQualityWithFiles).
 */
export function loadAnalysisQuality(
  result: AnalysisResult | null,
  projectRoot?: string | null,
): Promise<QualityIndex | null> {
  if (qualityInMemory(result?.quality)) {
    return Promise.resolve(result!.quality!);
  }
  if (!qualityPromise) {
    qualityPromise = loadPersistedAnalysisQuality(projectRoot);
  }
  return qualityPromise;
}

/**
 * Merge per-file quality from cache when module details / file lists need it.
 */
export function loadAnalysisQualityWithFiles(
  result: AnalysisResult | null,
  projectRoot?: string | null,
): Promise<QualityIndex | null> {
  if (qualityFilesHydrated(result?.quality)) {
    return Promise.resolve(result!.quality!);
  }
  if (!qualityFilesPromise) {
    qualityFilesPromise = (async () => {
      const base =
        (await loadAnalysisQuality(result, projectRoot)) ??
        ({ files: {}, packages: {} } satisfies QualityIndex);
      if (!projectRoot) return base;
      try {
        const files = await loadAnalysisQualityFiles(projectRoot);
        return {
          packages: base.packages,
          files: files ?? {},
        };
      } catch (err) {
        console.warn("Cached quality files unavailable", err);
        return base;
      }
    })();
  }
  return qualityFilesPromise;
}
