import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, QualityIndex } from "../analysis/types";
import { defaultPersistedState } from "./types";

function sampleQuality(path = "a.ts"): QualityIndex {
  return {
    files: {
      [path]: {
        path,
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
      },
    },
    packages: {
      ".": {
        path: ".",
        fileCount: 1,
        totalLoc: 10,
        complexity: { avg: 2, percentiles: { p50: 2, p80: 2, p90: 2 } },
        halstead: { avg: 40, percentiles: { p50: 40, p80: 40, p90: 40 } },
        cognitive: { avg: 2, percentiles: { p50: 2, p80: 2, p90: 2 } },
        maintainability: {
          avg: 80,
          percentiles: { p50: 80, p80: 80, p90: 80 },
        },
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
}

function sampleResult(quality?: QualityIndex | null): AnalysisResult {
  return {
    graph: { nodes: [], edges: [] },
    hierarchy: {
      files: [{ path: "a.ts", label: "a.ts", loc: 10, package: "." }],
      packages: ["."],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    },
    validation: [],
    suggestions: [],
    summary: "ok",
    dsm: null,
    quality: quality === undefined ? sampleQuality() : quality,
  };
}

describe("state/store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("exports persistence helpers", async () => {
    const { scheduleSaveUiState } = await import("./store");
    expect(typeof scheduleSaveUiState).toBe("function");
    expect(defaultPersistedState().version).toBe(1);
  });

  it("persists and restores quality index with analysis", async () => {
    const { loadPersistedAnalysis, savePersistedState } = await import("./store");
    const result = sampleResult();
    await savePersistedState({ ...defaultPersistedState(), analysisResult: result });

    expect(localStorage.getItem("devtree-analysis-quality")).toContain("a.ts");

    const loaded = await loadPersistedAnalysis();
    expect(loaded?.quality?.files["a.ts"]?.cyclomatic).toBe(2);
    expect(loaded?.quality?.packages["."]?.fileCount).toBe(1);
    expect(loaded?.hierarchy.files).toHaveLength(1);
  });

  it("stores null quality when result has empty quality", async () => {
    const { savePersistedState, loadPersistedAnalysisQuality } = await import(
      "./store"
    );
    await savePersistedState({
      ...defaultPersistedState(),
      analysisResult: sampleResult({ files: {}, packages: {} }),
    });
    expect(localStorage.getItem("devtree-analysis-quality")).toBe("null");
    expect(await loadPersistedAnalysisQuality()).toBeNull();
  });

  it("clears quality when analysis is cleared", async () => {
    const { loadPersistedAnalysisQuality, savePersistedState } = await import(
      "./store"
    );
    await savePersistedState({
      ...defaultPersistedState(),
      analysisResult: sampleResult(),
    });
    await savePersistedState({
      ...defaultPersistedState(),
      analysisResult: null,
    });
    expect(await loadPersistedAnalysisQuality()).toBeNull();
  });

  it("loadPersistedAnalysisQuality returns null when key missing", async () => {
    const { loadPersistedAnalysisQuality } = await import("./store");
    expect(await loadPersistedAnalysisQuality()).toBeNull();
  });

  it("loadPersistedState includes quality when present", async () => {
    const { loadPersistedState, savePersistedState } = await import("./store");
    await savePersistedState({
      ...defaultPersistedState(),
      percentileView: "p50",
      analysisResult: sampleResult(sampleQuality("q.ts")),
    });

    const state = await loadPersistedState();
    expect(state.percentileView).toBe("p50");
    expect(state.analysisResult?.quality?.files["q.ts"]?.path).toBe("q.ts");
  });

  it("loadPersistedUiState returns defaults when empty", async () => {
    const { loadPersistedUiState } = await import("./store");
    const ui = await loadPersistedUiState();
    expect(ui.version).toBe(1);
    expect(ui.percentileView).toBe("all");
  });

  it("migrates legacy combined analysis blob including quality", async () => {
    const legacy = sampleResult(sampleQuality("legacy.ts"));
    localStorage.setItem("devtree-analysis", JSON.stringify(legacy));

    const {
      loadPersistedAnalysisMeta,
      loadPersistedAnalysisHierarchy,
      loadPersistedAnalysisQuality,
    } = await import("./store");

    const meta = await loadPersistedAnalysisMeta();
    expect(meta?.summary).toBe("ok");
    const hierarchy = await loadPersistedAnalysisHierarchy();
    expect(hierarchy?.files[0]?.path).toBe("a.ts");
    const quality = await loadPersistedAnalysisQuality();
    expect(quality?.files["legacy.ts"]?.path).toBe("legacy.ts");
    expect(localStorage.getItem("devtree-analysis-quality")).toContain(
      "legacy.ts",
    );
  });

  it("uses empty hierarchy when hierarchy key missing but meta exists", async () => {
    localStorage.setItem(
      "devtree-analysis-meta",
      JSON.stringify({
        graph: { nodes: [], edges: [] },
        validation: [],
        suggestions: [],
        summary: "meta-only",
        dsm: null,
      }),
    );
    localStorage.setItem("devtree-analysis-hierarchy", "null");
    localStorage.setItem("devtree-analysis-quality", "null");

    const { loadPersistedAnalysis } = await import("./store");
    const loaded = await loadPersistedAnalysis();
    expect(loaded?.summary).toBe("meta-only");
    expect(loaded?.hierarchy.files).toEqual([]);
    expect(loaded?.quality).toBeNull();
  });

  it("scheduleSaveUiState writes app key after debounce", async () => {
    vi.useFakeTimers();
    const { scheduleSaveUiState, loadPersistedUiState } = await import("./store");
    scheduleSaveUiState({
      ...defaultPersistedState(),
      percentileView: "p80",
    });
    await vi.advanceTimersByTimeAsync(500);
    const ui = await loadPersistedUiState();
    expect(ui.percentileView).toBe("p80");
  });

  it("scheduleSaveAnalysis writes split keys via idle callback", async () => {
    vi.useFakeTimers();
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
      idleCallbacks.push(cb);
      return 1;
    });

    const { scheduleSaveAnalysis, loadPersistedAnalysisQuality } = await import(
      "./store"
    );
    scheduleSaveAnalysis(sampleResult(sampleQuality("idle.ts")));
    await vi.advanceTimersByTimeAsync(2100);
    expect(idleCallbacks).toHaveLength(1);
    idleCallbacks[0]!();
    await Promise.resolve();

    const quality = await loadPersistedAnalysisQuality();
    expect(quality?.files["idle.ts"]?.path).toBe("idle.ts");
    vi.unstubAllGlobals();
  });

  it("scheduleSaveState splits ui and analysis", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
      cb();
      return 1;
    });
    const { scheduleSaveState, loadPersistedState } = await import("./store");
    scheduleSaveState({
      ...defaultPersistedState(),
      percentileView: "p90",
      analysisResult: sampleResult(),
    });
    await vi.advanceTimersByTimeAsync(2500);
    const state = await loadPersistedState();
    expect(state.percentileView).toBe("p90");
    expect(state.analysisResult?.quality?.files["a.ts"]).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("ignores invalid JSON in analysis keys", async () => {
    localStorage.setItem("devtree-analysis-meta", "{not-json");
    localStorage.setItem("devtree-analysis-hierarchy", "{bad");
    localStorage.setItem("devtree-analysis-quality", "{bad");
    const { loadPersistedAnalysis } = await import("./store");
    expect(await loadPersistedAnalysis()).toBeNull();
  });
});
