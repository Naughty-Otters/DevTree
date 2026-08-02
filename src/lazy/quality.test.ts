import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, QualityIndex } from "../analysis/types";

const sampleFileMetrics = {
  path: "a.ts",
  loc: 10,
  cyclomatic: 2,
  structural: 2,
  halsteadVolume: 40,
  halsteadDifficulty: 4,
  cognitive: 2,
  maintainability: 80,
  dit: 0,
  cbo: 1,
  coverage: 100,
  issueDensity: 0,
  securityDensity: 0,
  aiDensity: 0,
  duplicationHits: 0,
};

const sampleQuality: QualityIndex = {
  files: {
    "a.ts": sampleFileMetrics,
  },
  packages: {
    ".": {
      path: ".",
      fileCount: 1,
      totalLoc: 10,
      complexity: { avg: 2, percentiles: { p50: 2, p80: 2, p90: 2 } },
      halstead: { avg: 40, percentiles: { p50: 40, p80: 40, p90: 40 } },
      cognitive: { avg: 2, percentiles: { p50: 2, p80: 2, p90: 2 } },
      maintainability: { avg: 80, percentiles: { p50: 80, p80: 80, p90: 80 } },
      cbo: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
      coverage: { avg: 100, percentiles: { p50: 100, p80: 100, p90: 100 } },
      issues: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
      security: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
      aiQuality: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
      duplication: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
      size: { avg: 10, percentiles: { p50: 10, p80: 10, p90: 10 } },
    },
  },
};

describe("lazy/quality", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("clears quality load cache without error", async () => {
    const { clearQualityLoadCache } = await import("./quality");
    expect(() => clearQualityLoadCache()).not.toThrow();
  });

  it("returns in-memory quality when already hydrated", async () => {
    const { loadAnalysisQuality } = await import("./quality");
    const result = {
      quality: sampleQuality,
    } as AnalysisResult;
    await expect(loadAnalysisQuality(result)).resolves.toEqual(sampleQuality);
  });

  it("treats package-only quality as hydrated", async () => {
    const { loadAnalysisQuality } = await import("./quality");
    const packagesOnly: QualityIndex = {
      files: {},
      packages: {
        pkg: {
          path: "pkg",
          fileCount: 1,
          totalLoc: 10,
          complexity: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          halstead: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          cognitive: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          maintainability: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          cbo: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          coverage: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          issues: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          security: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          aiQuality: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          duplication: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          size: { avg: 10, percentiles: { p50: 10, p80: 10, p90: 10 } },
        },
      },
    };
    await expect(
      loadAnalysisQuality({ quality: packagesOnly } as AnalysisResult),
    ).resolves.toEqual(packagesOnly);
  });

  it("loads quality from persistence when result lacks it", async () => {
    const { savePersistedState } = await import("../state/store");
    const { defaultPersistedState } = await import("../state/types");
    const projectPath = "/tmp/lazy-quality-project";
    await savePersistedState({
      ...defaultPersistedState(),
      projectPath,
      analysisResult: {
        graph: { nodes: [], edges: [] },
        hierarchy: {
          files: [],
          packages: [],
          file_imports: {},
          package_edges: [],
          symbols: {},
          symbol_edges: [],
        },
        validation: [],
        suggestions: [],
        summary: "",
        quality: sampleQuality,
      },
    });

    const { clearQualityLoadCache, loadAnalysisQuality } = await import(
      "./quality"
    );
    clearQualityLoadCache();
    const loaded = await loadAnalysisQuality(
      {
        graph: { nodes: [], edges: [] },
        hierarchy: {
          files: [],
          packages: [],
          file_imports: {},
          package_edges: [],
          symbols: {},
          symbol_edges: [],
        },
        validation: [],
        suggestions: [],
        summary: "",
        quality: null,
      },
      projectPath,
    );
    // Persistence keeps package rollups only — file metrics stay in cache files.
    expect(loaded?.packages["."]?.fileCount).toBe(1);
    expect(loaded?.files).toEqual({});
  });
});
