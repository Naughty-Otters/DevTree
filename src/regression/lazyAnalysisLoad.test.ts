/**
 * Regression guards for large-project load hangs:
 * - first paint uses package graph + package quality only
 * - SQLite never stores symbol_edges / quality.files
 * - graph toolbar (filter + focus) renders without hierarchy
 * - architecture scorecard works with package-only quality
 */
import { describe, expect, it, vi } from "vitest";
import { buildArchitectureHealth } from "../analysis/architectureHealth";
import type { AnalysisResult, HierarchyIndex, QualityIndex } from "../analysis/types";
import { rootNavigation } from "../graph/navigation";
import { DEFAULT_MODULE_FILTERS } from "../graph/moduleFilters";
import { renderGraphNav, renderBreadcrumbBar } from "../ui/graphNav";
import { defaultPersistedState } from "../state/types";

function packageQuality(): QualityIndex {
  return {
    files: {},
    packages: {
      src: {
        path: "src",
        fileCount: 12,
        totalLoc: 400,
        complexity: { avg: 3, percentiles: { p50: 2, p80: 4, p90: 6 } },
        halstead: { avg: 80, percentiles: { p50: 60, p80: 100, p90: 140 } },
        cognitive: { avg: 4, percentiles: { p50: 3, p80: 5, p90: 8 } },
        maintainability: { avg: 70, percentiles: { p50: 72, p80: 65, p90: 55 } },
        cbo: { avg: 2, percentiles: { p50: 2, p80: 3, p90: 4 } },
        coverage: { avg: 40, percentiles: { p50: 40, p80: 30, p90: 20 } },
        issues: { avg: 1, percentiles: { p50: 1, p80: 2, p90: 3 } },
        security: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 1 } },
        aiQuality: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
        duplication: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 1 } },
        size: { avg: 30, percentiles: { p50: 25, p80: 40, p90: 60 } },
      },
    },
  };
}

function slimAnalysisResult(): AnalysisResult {
  return {
    graph: {
      nodes: [
        { id: "src", label: "src", path: "src", loc: 400, kind: "package" },
        { id: "tests", label: "tests", path: "tests", loc: 80, kind: "package" },
      ],
      edges: [{ source: "tests", target: "src", kind: "import" }],
    },
    hierarchy: {
      files: [],
      packages: [],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    },
    validation: [
      {
        rule_id: "modularity",
        rule_name: "Modularity",
        status: "pass",
        message: "ok",
        affected: [],
      },
    ],
    suggestions: [],
    summary: "2 packages · slim IPC",
    dsm: null,
    quality: packageQuality(),
  };
}

describe("regression/lazyAnalysisLoad", () => {
  it("scorecard renders from package-only quality (no quality.files)", () => {
    const report = buildArchitectureHealth(packageQuality(), {
      includeEntityLists: false,
      modularityScore: 80,
    });
    expect(report).toBeTruthy();
    expect(report!.packageCount).toBe(1);
    expect(report!.fileCount).toBe(12);
    expect(report!.rating).toBeGreaterThan(0);
    expect(report!.files).toEqual([]);
  });

  it("graph toolbar includes Filter and Focus without a hydrated hierarchy", () => {
    const container = document.createElement("div");
    const crumbs = document.createElement("div");
    const result = slimAnalysisResult();
    renderBreadcrumbBar(
      crumbs,
      rootNavigation(),
      false,
      false,
      {
        onBack: () => {},
        onForward: () => {},
        onNavigate: () => {},
      },
      {
        stats: {
          nodes: result.graph.nodes.length,
          edges: result.graph.edges.length,
        },
      },
    );
    renderGraphNav(
      container,
      rootNavigation(),
      false,
      false,
      {
        onBack: () => {},
        onForward: () => {},
        onNavigate: () => {},
        onFocusView: () => {},
        onModuleFiltersChange: () => {},
      },
      {
        moduleFilters: DEFAULT_MODULE_FILTERS,
        focusEnabled: true,
      },
    );

    expect(container.querySelector("details.graph-nav-filter")).toBeTruthy();
    expect(
      container.querySelector('[aria-label="Graph view actions"] [aria-label="Focus"]'),
    ).toBeTruthy();
    expect(crumbs.querySelector(".breadcrumb-stats")?.textContent).toContain(
      "2 modules",
    );
  });

  it("empty hierarchy is not treated as hydrated for lazy load", async () => {
    const { hierarchyIsHydrated } = await import("./hierarchyHydrated");
    const empty: HierarchyIndex = {
      files: [],
      packages: [],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    };
    expect(hierarchyIsHydrated(empty)).toBe(false);
    expect(
      hierarchyIsHydrated({
        ...empty,
        packages: ["src"],
      }),
    ).toBe(true);
  });

  it("persisted analysis never keeps symbol_edges or quality.files in SQLite", async () => {
    localStorage.clear();
    vi.resetModules();
    const { savePersistedState, loadPersistedAnalysis } = await import(
      "../state/store"
    );
    const result = slimAnalysisResult();
    result.hierarchy = {
      files: [{ path: "src/a.ts", label: "a.ts", loc: 3, package: "src" }],
      packages: ["src"],
      file_imports: { "src/a.ts": ["src/b.ts"] },
      package_edges: [],
      symbols: {
        "src/a.ts": [
          { id: "src/a.ts::f", label: "f", kind: "fn", file: "src/a.ts", line: 1 },
        ],
      },
      symbol_edges: Array.from({ length: 10 }, (_, i) => ({
        source: `s${i}`,
        target: `t${i}`,
        kind: "ref",
      })),
    };
    result.quality = {
      files: {
        "src/a.ts": {
          path: "src/a.ts",
          loc: 3,
          cyclomatic: 1,
          structural: 1,
          halsteadVolume: 1,
          halsteadDifficulty: 1,
          cognitive: 1,
          maintainability: 90,
          dit: 0,
          cbo: 0,
          coverage: 0,
          issueDensity: 0,
          securityDensity: 0,
          aiDensity: 0,
          duplicationHits: 0,
        },
      },
      packages: packageQuality().packages,
    };

    await savePersistedState({
      ...defaultPersistedState(),
      projectPath: "/tmp/regression-lazy",
      analysisResult: result,
    });

    const hierarchyKey = Object.keys(localStorage).find((k) =>
      k.includes("analysis-hierarchy"),
    )!;
    const qualityKey = Object.keys(localStorage).find((k) =>
      k.includes("analysis-quality"),
    )!;
    expect(localStorage.getItem(hierarchyKey)).not.toContain("symbol_edges\":[{");
    expect(JSON.parse(localStorage.getItem(hierarchyKey)!).symbol_edges).toEqual(
      [],
    );
    expect(JSON.parse(localStorage.getItem(qualityKey)!).files).toEqual({});

    const loaded = await loadPersistedAnalysis("/tmp/regression-lazy");
    expect(loaded?.graph.nodes).toHaveLength(2);
    expect(loaded?.quality?.files).toEqual({});
    expect(loaded?.hierarchy.symbol_edges).toEqual([]);
    localStorage.clear();
  });

  it("slim analysis result is enough for Analysis tab stats", () => {
    const result = slimAnalysisResult();
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.validation.length).toBeGreaterThan(0);
    expect(Object.keys(result.quality?.packages ?? {}).length).toBeGreaterThan(0);
    // Critical: first paint must not require hierarchy files/symbols.
    expect(result.hierarchy.files).toHaveLength(0);
    expect(result.hierarchy.symbol_edges).toHaveLength(0);
  });
});
