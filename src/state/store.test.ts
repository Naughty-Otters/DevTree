import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, QualityIndex } from "../analysis/types";
import { defaultPersistedState } from "./types";

const PROJECT_A = "/tmp/project-a";
const PROJECT_B = "/tmp/project-b";

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
    graph: {
      nodes: [{ id: ".", label: "root", path: ".", loc: 10, kind: "package" }],
      edges: [],
    },
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

function scopedKey(kind: string, root: string): string {
  return `devtree-analysis-${kind}::${root}`;
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

  it("persists package quality and hierarchy-lite — never quality.files or symbols", async () => {
    const { loadPersistedAnalysis, savePersistedState } = await import("./store");
    const result = sampleResult();
    result.hierarchy.symbols = {
      "a.ts": [{ id: "a.ts::x", label: "x", kind: "fn", file: "a.ts", line: 1 }],
    };
    result.hierarchy.symbol_edges = [
      { source: "a", target: "b", kind: "ref" },
    ];
    await savePersistedState({
      ...defaultPersistedState(),
      projectPath: PROJECT_A,
      analysisResult: result,
    });

    const qualityRaw = localStorage.getItem(scopedKey("quality", PROJECT_A))!;
    expect(qualityRaw).toContain('"packages"');
    expect(qualityRaw).not.toContain("a.ts");
    expect(JSON.parse(qualityRaw).files).toEqual({});

    const hierarchyRaw = localStorage.getItem(scopedKey("hierarchy", PROJECT_A))!;
    const hierarchy = JSON.parse(hierarchyRaw);
    expect(hierarchy.files).toHaveLength(1);
    expect(hierarchy.symbols).toEqual({});
    expect(hierarchy.symbol_edges).toEqual([]);

    const loaded = await loadPersistedAnalysis(PROJECT_A);
    expect(loaded?.quality?.packages["."]?.fileCount).toBe(1);
    expect(loaded?.quality?.files).toEqual({});
    expect(loaded?.hierarchy.files).toHaveLength(1);
    expect(loaded?.hierarchy.symbol_edges).toEqual([]);
  });

  it("does not restore project A analysis when opening project B", async () => {
    const { loadPersistedAnalysis, savePersistedState } = await import("./store");
    await savePersistedState({
      ...defaultPersistedState(),
      projectPath: PROJECT_A,
      analysisResult: sampleResult(sampleQuality("from-a.ts")),
    });
    await savePersistedState({
      ...defaultPersistedState(),
      projectPath: PROJECT_B,
      analysisResult: null,
    });

    expect(await loadPersistedAnalysis(PROJECT_B)).toBeNull();
    const a = await loadPersistedAnalysis(PROJECT_A);
    expect(a?.quality?.packages["."]?.fileCount).toBe(1);
  });

  it("stores null quality when result has empty quality", async () => {
    const { savePersistedState, loadPersistedAnalysisQuality } = await import(
      "./store"
    );
    await savePersistedState({
      ...defaultPersistedState(),
      projectPath: PROJECT_A,
      analysisResult: sampleResult({ files: {}, packages: {} }),
    });
    expect(localStorage.getItem(scopedKey("quality", PROJECT_A))).toBe("null");
    expect(await loadPersistedAnalysisQuality(PROJECT_A)).toBeNull();
  });

  it("clears quality when analysis is cleared for that project", async () => {
    const { loadPersistedAnalysisQuality, savePersistedState } = await import(
      "./store"
    );
    await savePersistedState({
      ...defaultPersistedState(),
      projectPath: PROJECT_A,
      analysisResult: sampleResult(),
    });
    await savePersistedState({
      ...defaultPersistedState(),
      projectPath: PROJECT_A,
      analysisResult: null,
    });
    expect(await loadPersistedAnalysisQuality(PROJECT_A)).toBeNull();
  });

  it("loadPersistedAnalysisQuality returns null when key missing", async () => {
    const { loadPersistedAnalysisQuality } = await import("./store");
    expect(await loadPersistedAnalysisQuality(PROJECT_A)).toBeNull();
  });

  it("loadPersistedState includes package quality for ui project", async () => {
    const { loadPersistedState, savePersistedState } = await import("./store");
    await savePersistedState({
      ...defaultPersistedState(),
      projectPath: PROJECT_A,
      percentileView: "p50",
      analysisResult: sampleResult(sampleQuality("q.ts")),
    });

    const state = await loadPersistedState();
    expect(state.percentileView).toBe("p50");
    expect(state.analysisResult?.quality?.packages["."]?.fileCount).toBe(1);
    expect(state.analysisResult?.quality?.files).toEqual({});
  });

  it("loadPersistedUiState returns defaults when empty", async () => {
    const { loadPersistedUiState } = await import("./store");
    const ui = await loadPersistedUiState();
    expect(ui.version).toBe(1);
    expect(ui.percentileView).toBe("all");
  });

  it("migrates legacy combined analysis blob into slim split keys", async () => {
    const legacy = sampleResult(sampleQuality("legacy.ts"));
    localStorage.setItem("devtree-analysis", JSON.stringify(legacy));

    const {
      loadPersistedAnalysisMeta,
      loadPersistedAnalysisHierarchy,
      loadPersistedAnalysisQuality,
    } = await import("./store");

    const meta = await loadPersistedAnalysisMeta(PROJECT_A);
    expect(meta?.summary).toBe("ok");
    const hierarchy = await loadPersistedAnalysisHierarchy(PROJECT_A);
    expect(hierarchy?.files[0]?.path).toBe("a.ts");
    const quality = await loadPersistedAnalysisQuality(PROJECT_A);
    expect(quality?.packages["."]?.fileCount).toBe(1);
    expect(quality?.files).toEqual({});
    expect(localStorage.getItem(scopedKey("quality", PROJECT_A))).not.toContain(
      "legacy.ts",
    );
  });

  it("ignores oversized legacy hierarchy blobs in SQLite", async () => {
    const edges = Array.from({ length: 50_001 }, (_, i) => ({
      source: `s${i}`,
      target: `t${i}`,
      kind: "ref",
    }));
    localStorage.setItem(
      scopedKey("meta", PROJECT_A),
      JSON.stringify({
        graph: { nodes: [], edges: [] },
        validation: [],
        suggestions: [],
        summary: "huge",
        dsm: null,
        projectRoot: PROJECT_A,
      }),
    );
    localStorage.setItem(
      scopedKey("hierarchy", PROJECT_A),
      JSON.stringify({
        files: [{ path: "a.ts", label: "a.ts", loc: 1, package: "." }],
        packages: ["."],
        file_imports: {},
        package_edges: [],
        symbols: {},
        symbol_edges: edges,
      }),
    );
    localStorage.setItem(scopedKey("quality", PROJECT_A), "null");

    const { loadPersistedAnalysisHierarchy } = await import("./store");
    expect(await loadPersistedAnalysisHierarchy(PROJECT_A)).toBeNull();
  });

  it("uses empty hierarchy when hierarchy key missing but meta exists", async () => {
    localStorage.setItem(
      scopedKey("meta", PROJECT_A),
      JSON.stringify({
        graph: { nodes: [], edges: [] },
        validation: [],
        suggestions: [],
        summary: "meta-only",
        dsm: null,
        projectRoot: PROJECT_A,
      }),
    );
    localStorage.setItem(scopedKey("hierarchy", PROJECT_A), "null");
    localStorage.setItem(scopedKey("quality", PROJECT_A), "null");

    const { loadPersistedAnalysis } = await import("./store");
    const loaded = await loadPersistedAnalysis(PROJECT_A);
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

  it("scheduleSaveAnalysis writes package quality via idle callback", async () => {
    vi.useFakeTimers();
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
      idleCallbacks.push(cb);
      return 1;
    });

    const { scheduleSaveAnalysis, loadPersistedAnalysisQuality } = await import(
      "./store"
    );
    scheduleSaveAnalysis(sampleResult(sampleQuality("idle.ts")), PROJECT_A);
    await vi.advanceTimersByTimeAsync(2100);
    expect(idleCallbacks).toHaveLength(1);
    idleCallbacks[0]!();
    await Promise.resolve();

    const quality = await loadPersistedAnalysisQuality(PROJECT_A);
    expect(quality?.packages["."]?.fileCount).toBe(1);
    expect(quality?.files).toEqual({});
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
      projectPath: PROJECT_A,
      percentileView: "p90",
      analysisResult: sampleResult(),
    });
    await vi.advanceTimersByTimeAsync(2500);
    const state = await loadPersistedState();
    expect(state.percentileView).toBe("p90");
    expect(state.analysisResult?.quality?.packages["."]).toBeTruthy();
    expect(state.analysisResult?.graph.nodes.length).toBe(1);
    vi.unstubAllGlobals();
  });

  it("ignores invalid JSON in analysis keys", async () => {
    localStorage.setItem(scopedKey("meta", PROJECT_A), "{not-json");
    localStorage.setItem(scopedKey("hierarchy", PROJECT_A), "{bad");
    localStorage.setItem(scopedKey("quality", PROJECT_A), "{bad");
    const { loadPersistedAnalysis } = await import("./store");
    expect(await loadPersistedAnalysis(PROJECT_A)).toBeNull();
  });

  it("rejects tagged analysis from another project root", async () => {
    localStorage.setItem(
      scopedKey("meta", PROJECT_B),
      JSON.stringify({
        graph: { nodes: [], edges: [] },
        validation: [],
        suggestions: [],
        summary: "from-b",
        dsm: null,
        projectRoot: PROJECT_A,
      }),
    );
    const { loadPersistedAnalysisMeta } = await import("./store");
    expect(await loadPersistedAnalysisMeta(PROJECT_B)).toBeNull();
  });
});
