import { describe, expect, it, vi } from "vitest";
import { createResultsPanel } from "./resultsPanel";
import type { AnalysisResult } from "../analysis/types";
import type { DsmResult } from "../analysis/dsm";
import { HIERARCHY_VERSION } from "../analysis/types";

function makeDsm(overrides: Partial<DsmResult> = {}): DsmResult {
  return {
    level: "package",
    scope: ".",
    ordering: "partitioned",
    elements: [
      { id: "a", label: "a" },
      { id: "b", label: "b" },
    ],
    matrix: [
      [0, 0],
      [1, 0],
    ],
    metrics: {
      cycleCount: 0,
      nodesInCycles: 0,
      upperTriangleDensity: 0,
      couplingDensity: 0.25,
      propagationCost: 0.5,
      clusteredCost: 10,
      clusteredCostNormalized: 0.2,
      busCount: 0,
      healthScore: 85,
    },
    cycleNodes: [],
    busIds: [],
    violations: [],
    capped: false,
    ...overrides,
  };
}

function makeResult(
  dsm: DsmResult | null,
  overrides: Partial<AnalysisResult> = {},
): AnalysisResult {
  return {
    graph: { nodes: [], edges: [] },
    hierarchy: {
      version: HIERARCHY_VERSION,
      files: [],
      packages: ["a", "b"],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    },
    validation: [],
    suggestions: [],
    summary: "test",
    dsm,
    ...overrides,
  };
}

function makeQuality(): NonNullable<AnalysisResult["quality"]> {
  const rollup = (avg: number) => ({
    avg,
    percentiles: { p50: avg, p80: avg * 1.5, p90: avg * 2 },
  });
  return {
    files: {
      "a/x.ts": {
        path: "a/x.ts",
        loc: 40,
        cyclomatic: 4,
        structural: 4,
        halsteadVolume: 120,
        halsteadDifficulty: 8,
        cognitive: 4,
        maintainability: 75,
        dit: 1,
        cbo: 2,
        coverage: 100,
        issueDensity: 0,
        securityDensity: 0,
        aiDensity: 0,
        duplicationHits: 0,
      },
      "b/y.ts": {
        path: "b/y.ts",
        loc: 200,
        cyclomatic: 30,
        structural: 20,
        halsteadVolume: 900,
        halsteadDifficulty: 20,
        cognitive: 25,
        maintainability: 40,
        dit: 2,
        cbo: 8,
        coverage: 0,
        issueDensity: 5,
        securityDensity: 1,
        aiDensity: 0,
        duplicationHits: 1,
      },
    },
    packages: {
      a: {
        path: "a",
        fileCount: 1,
        totalLoc: 40,
        complexity: rollup(4),
        halstead: rollup(120),
        cognitive: rollup(4),
        maintainability: rollup(75),
        cbo: rollup(2),
        coverage: rollup(100),
        issues: rollup(0),
        security: rollup(0),
        aiQuality: rollup(0),
        duplication: rollup(0),
        size: rollup(40),
      },
      b: {
        path: "b",
        fileCount: 1,
        totalLoc: 200,
        complexity: rollup(30),
        halstead: rollup(900),
        cognitive: rollup(25),
        maintainability: rollup(40),
        cbo: rollup(8),
        coverage: rollup(0),
        issues: rollup(5),
        security: rollup(1),
        aiQuality: rollup(0),
        duplication: rollup(1),
        size: rollup(200),
      },
    },
  };
}

describe("resultsPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createResultsPanel(container)).not.toThrow();
    expect(container).toBeDefined();
  });

  it("shows Health tab with MacCormack metrics", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    panel.setResult(makeResult(makeDsm()));

    const healthTab = [...container.querySelectorAll(".results-tab")].find(
      (t) => t.textContent === "Health",
    ) as HTMLButtonElement;
    expect(healthTab).toBeTruthy();
    healthTab.click();

    expect(container.textContent).toContain("Modularity health");
    expect(container.textContent).toContain("Propagation cost");
    expect(container.textContent).toContain("Clustered cost");
    expect(container.textContent).toContain("Vertical buses");
  });

  it("shows empty health guidance when DSM missing", () => {
    const container = document.createElement("div");
    const onShowDsm = vi.fn();
    const panel = createResultsPanel(container, { onShowDsm });
    panel.setResult(makeResult(null));

    const healthTab = [...container.querySelectorAll(".results-tab")].find(
      (t) => t.textContent === "Health",
    ) as HTMLButtonElement;
    healthTab.click();

    expect(container.textContent).toContain("No DSM health data");
    const openBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Open DSM"),
    );
    openBtn?.click();
    expect(onShowDsm).toHaveBeenCalled();
  });

  it("surfaces LDM violations and show-in-DSM action", () => {
    const container = document.createElement("div");
    const onShowDsm = vi.fn();
    const panel = createResultsPanel(container, { onShowDsm });
    panel.setResult(
      makeResult(
        makeDsm({
          violations: [
            {
              ruleId: "L1",
              from: "a",
              to: "b",
              message: "Layer violation",
            },
          ],
          metrics: {
            ...makeDsm().metrics,
            healthScore: 40,
          },
        }),
      ),
    );

    const healthTab = [...container.querySelectorAll(".results-tab")].find(
      (t) => t.textContent === "Health",
    ) as HTMLButtonElement;
    healthTab.click();

    expect(container.textContent).toContain("LDM conformance");
    expect(container.textContent).toContain("1 violation");
    const showViol = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Show violations"),
    );
    showViol!.click();
    expect(onShowDsm).toHaveBeenCalled();
  });

  it("shows poor health styling for low scores", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    panel.setResult(
      makeResult(
        makeDsm({
          metrics: { ...makeDsm().metrics, healthScore: 20 },
        }),
      ),
    );
    const healthTab = [...container.querySelectorAll(".results-tab")].find(
      (t) => t.textContent === "Health",
    ) as HTMLButtonElement;
    healthTab.click();
    expect(container.querySelector(".health-poor")).toBeTruthy();
  });

  it("shows Progress tab and keeps stream channel after completion", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    const progressTab = [...container.querySelectorAll(".results-tab")].find(
      (t) => t.textContent === "Progress",
    ) as HTMLButtonElement;
    expect(progressTab).toBeTruthy();

    const startedAt = Date.now();
    panel.setRuns([
      {
        id: "run-1",
        label: "Run #1",
        startedAt,
        status: "running",
        progress: {
          analysisId: "run-1",
          stage: "validating",
          message: "AI reviewing…",
          current: 1,
          total: 2,
          percent: 50,
          aiStream: {
            ruleId: "ai_code_review",
            ruleName: "AI Code Reviewer",
            thinking: "",
            text: "Finding one",
            status: "running",
          },
        },
        ruleTasks: [],
        result: null,
        error: null,
      },
    ]);

    expect(progressTab.classList.contains("active")).toBe(true);
    expect(container.querySelector(".analysis-run-stream")).toBeTruthy();
    expect(
      container.querySelector(".analysis-run-stream")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(container.textContent).toContain("Finding one");

    panel.setRuns([
      {
        id: "run-1",
        label: "Run #1",
        startedAt,
        status: "completed",
        progress: {
          analysisId: "run-1",
          stage: "done",
          message: "Analysis complete",
          current: 2,
          total: 2,
          percent: 100,
          aiStream: {
            ruleId: "ai_code_review",
            ruleName: "AI Code Reviewer",
            thinking: "",
            text: "Finding one",
            status: "done",
          },
        },
        ruleTasks: [],
        result: makeResult(makeDsm()),
        error: null,
      },
    ]);

    const analysisTab = [...container.querySelectorAll(".results-tab")].find(
      (t) => t.textContent === "Analysis",
    ) as HTMLButtonElement;
    expect(analysisTab.classList.contains("active")).toBe(true);
    expect(
      container.querySelector(".results-progress-content")?.hasAttribute("hidden"),
    ).toBe(true);

    progressTab.click();
    expect(
      container.querySelector(".results-progress-content")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(container.querySelector(".analysis-run-stream")).toBeTruthy();
    expect(container.textContent).toContain("Finding one");
  });

  it("renders architecture health and switches percentile view", () => {
    const container = document.createElement("div");
    let view: "avg" | "p50" | "p80" | "p90" | "all" = "all";
    const onShowModuleOnGraph = vi.fn();
    const panel = createResultsPanel(container, {
      getPercentileView: () => view,
      onPercentileViewChange: (mode) => {
        view = mode;
      },
      onShowModuleOnGraph,
    });
    panel.setResult(makeResult(makeDsm(), { quality: makeQuality() }));

    expect(container.textContent).toContain("Architecture health");
    expect(container.querySelector(".percentile-view-switch")).toBeTruthy();
    expect(container.textContent).toContain("Package ratings");
    expect(container.querySelector(".arch-ratings-subtabs")).toBeTruthy();

    const p50Btn = [...container.querySelectorAll(".percentile-view-btn")].find(
      (b) => b.textContent === "p50",
    ) as HTMLButtonElement;
    p50Btn.click();
    expect(view).toBe("p50");
    expect(container.textContent).toMatch(/Architecture · p50/);

    const packageCard = container.querySelector(
      ".arch-rating-card",
    ) as HTMLButtonElement;
    expect(packageCard).toBeTruthy();
    packageCard.click();
    expect(onShowModuleOnGraph).toHaveBeenCalled();

    const fileTab = [...container.querySelectorAll(".arch-ratings-subtab")].find(
      (b) => b.textContent?.includes("File ratings"),
    ) as HTMLButtonElement;
    fileTab.click();
    expect(container.querySelector(".paged-grid-pager")).toBeTruthy();

    const worseFirst = [...container.querySelectorAll(".arch-ratings-sort-btn")].find(
      (b) => b.textContent === "Worse → good",
    ) as HTMLButtonElement;
    expect(worseFirst).toBeTruthy();
    worseFirst.click();
    expect(worseFirst.classList.contains("active")).toBe(true);
  });

  it("shows quality unavailable guidance without quality index", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    panel.setResult(makeResult(makeDsm()));
    expect(container.textContent).toMatch(/Architecture quality metrics unavailable/);
  });

  it("showTab switches to Analysis after completion path", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    panel.showTab("progress");
    const progressTab = [...container.querySelectorAll(".results-tab")].find(
      (t) => t.textContent === "Progress",
    ) as HTMLButtonElement;
    expect(progressTab.classList.contains("active")).toBe(true);

    panel.showTab("analysis");
    const analysisTab = [...container.querySelectorAll(".results-tab")].find(
      (t) => t.textContent === "Analysis",
    ) as HTMLButtonElement;
    expect(analysisTab.classList.contains("active")).toBe(true);
  });

  it("places newest runs first and auto-collapses older ones", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);

    panel.setRuns([
      {
        id: "run-1",
        label: "Run #1",
        startedAt: 1000,
        status: "running",
        progress: {
          analysisId: "run-1",
          stage: "scanning",
          message: "Scanning…",
          current: 0,
          total: 1,
          percent: 0,
        },
        ruleTasks: [],
        result: null,
        error: null,
      },
    ]);

    const firstCard = container.querySelector(".analysis-run-card") as HTMLElement;
    expect(firstCard.classList.contains("is-collapsed")).toBe(false);
    expect(firstCard.querySelector(".analysis-run-body")?.hasAttribute("hidden")).toBe(
      false,
    );

    panel.setRuns([
      {
        id: "run-1",
        label: "Run #1",
        startedAt: 1000,
        status: "completed",
        progress: {
          analysisId: "run-1",
          stage: "done",
          message: "Analysis complete",
          current: 1,
          total: 1,
          percent: 100,
        },
        ruleTasks: [],
        result: makeResult(makeDsm()),
        error: null,
      },
      {
        id: "run-2",
        label: "Run #2",
        startedAt: 2000,
        status: "running",
        progress: {
          analysisId: "run-2",
          stage: "validating",
          message: "Validating…",
          current: 1,
          total: 2,
          percent: 50,
        },
        ruleTasks: [],
        result: null,
        error: null,
      },
    ]);

    const cards = [
      ...container.querySelectorAll(".analysis-run-card"),
    ] as HTMLElement[];
    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.runId).toBe("run-2");
    expect(cards[1].dataset.runId).toBe("run-1");
    expect(cards[0].classList.contains("is-collapsed")).toBe(false);
    expect(cards[1].classList.contains("is-collapsed")).toBe(true);
    expect(cards[1].querySelector(".analysis-run-body")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(cards[1].textContent).toContain("Complete");

    const toggle = cards[1].querySelector(
      ".analysis-run-toggle",
    ) as HTMLButtonElement;
    toggle.click();
    expect(cards[1].classList.contains("is-collapsed")).toBe(false);
    expect(cards[1].querySelector(".analysis-run-body")?.hasAttribute("hidden")).toBe(
      false,
    );
  });
});
