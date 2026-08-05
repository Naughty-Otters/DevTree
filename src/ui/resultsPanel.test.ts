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

  it("shows summary counts as Analysis tab stat cards", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    const summary =
      "Analyzed 2 packages (178 source files) with 3 rule(s): 0 passed, 2 warnings, 1 failures · modularity health 97";
    const rollup = { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } };
    const zero = { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } };
    panel.setResult(
      makeResult(makeDsm({ metrics: { ...makeDsm().metrics, healthScore: 97 } }), {
        summary,
        quality: {
          files: {},
          packages: {
            a: {
              path: "a",
              fileCount: 100,
              totalLoc: 10,
              complexity: rollup,
              halstead: rollup,
              cognitive: rollup,
              maintainability: rollup,
              cbo: rollup,
              coverage: rollup,
              issues: zero,
              security: zero,
              aiQuality: zero,
              duplication: zero,
              size: rollup,
            },
            b: {
              path: "b",
              fileCount: 78,
              totalLoc: 10,
              complexity: rollup,
              halstead: rollup,
              cognitive: rollup,
              maintainability: rollup,
              cbo: rollup,
              coverage: rollup,
              issues: zero,
              security: zero,
              aiQuality: zero,
              duplication: zero,
              size: rollup,
            },
          },
        },
        validation: [
          {
            rule_id: "w1",
            rule_name: "W1",
            status: "warn",
            message: "w",
            affected: [],
          },
          {
            rule_id: "w2",
            rule_name: "W2",
            status: "warn",
            message: "w",
            affected: [],
          },
          {
            rule_id: "f1",
            rule_name: "F1",
            status: "fail",
            message: "f",
            affected: [],
          },
        ],
      }),
    );
    expect(container.querySelector(".result-summary")?.textContent).toBe(summary);
    const labels = [...container.querySelectorAll(".result-stats .stat-label")].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual([
      "Packages",
      "Source files",
      "Rules",
      "Passed",
      "Warnings",
      "Failures",
      "Modularity health",
    ]);
    const values = [...container.querySelectorAll(".result-stats .stat-value")].map(
      (el) => el.textContent,
    );
    expect(values).toEqual(["2", "178", "3", "0", "2", "1", "97"]);
  });

  it("embeds Modularity health on the Analysis tab with MacCormack metrics", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    panel.setResult(makeResult(makeDsm()));

    const tabLabels = [...container.querySelectorAll(".results-tab")].map(
      (t) => t.textContent,
    );
    expect(tabLabels).toEqual(["Analysis", "Validation", "Progress"]);
    expect(container.querySelector("#modularity-health-section")).toBeTruthy();
    expect(container.textContent).toContain("Modularity health");
    expect(container.textContent).toContain("Propagation cost");
    expect(container.textContent).toContain("Clustered cost");
    expect(container.textContent).toContain("Vertical buses");

    const prop = [
      ...container.querySelectorAll(
        "#modularity-health-section .health-metric",
      ),
    ].find((el) => el.textContent?.includes("Propagation cost"));
    expect(prop).toBeTruthy();
    expect(prop!.querySelector(".metric-info-mark")).toBeTruthy();
    (prop as HTMLElement).click();
    const popup = document.querySelector<HTMLElement>(".metric-def-popup");
    expect(popup).toBeTruthy();
    expect(popup!.classList.contains("hidden")).toBe(false);
    expect(popup!.textContent).toMatch(/propagation|MacCormack|N²/i);
  });

  it("renders the overall report in a main-view host instead of bottom Analysis tab", () => {
    const bottom = document.createElement("div");
    const reportHost = document.createElement("div");
    const onRequestShowReport = vi.fn();
    const panel = createResultsPanel(
      bottom,
      { onRequestShowReport },
      { reportHost },
    );
    panel.setResult(makeResult(makeDsm(), { quality: makeQuality() }));

    const tabLabels = [...bottom.querySelectorAll(".results-tab")].map(
      (t) => t.textContent,
    );
    expect(tabLabels).toEqual(["Validation", "Progress"]);
    expect(bottom.querySelector(".analysis-report")).toBeNull();
    expect(reportHost.querySelector(".analysis-report-title")?.textContent).toBe(
      "Analysis report",
    );
    expect(reportHost.textContent).toContain("Architecture health");
    expect(reportHost.textContent).toContain("Modularity health");

    panel.showTab("analysis");
    expect(onRequestShowReport).toHaveBeenCalled();
  });

  it("renders Progress in a main-view host and activates it when a run starts", () => {
    const bottom = document.createElement("div");
    const progressHost = document.createElement("div");
    const onRequestShowProgress = vi.fn();
    const panel = createResultsPanel(
      bottom,
      { onRequestShowProgress },
      { progressHost },
    );

    const tabLabels = [...bottom.querySelectorAll(".results-tab")].map(
      (t) => t.textContent,
    );
    expect(tabLabels).toEqual(["Analysis", "Validation"]);

    panel.setRuns([
      {
        id: "run-1",
        label: "Run #1",
        startedAt: Date.now(),
        status: "running",
        progress: {
          analysisId: "run-1",
          stage: "scanning",
          message: "Scanning…",
          current: 1,
          total: 4,
          percent: 25,
        },
        ruleTasks: [],
        result: null,
        error: null,
      },
    ]);

    expect(onRequestShowProgress).toHaveBeenCalled();
    expect(progressHost.textContent).toContain("in progress");
    expect(progressHost.querySelector(".analysis-run-card")).toBeTruthy();
    expect(bottom.querySelector(".analysis-run-card")).toBeNull();
  });

  it("shows empty modularity guidance on Analysis when DSM missing", () => {
    const container = document.createElement("div");
    const onShowDsm = vi.fn();
    const panel = createResultsPanel(container, { onShowDsm });
    panel.setResult(makeResult(null));

    expect(container.textContent).toContain("No modularity health yet");
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

    expect(container.textContent).toContain("LDM conformance");
    expect(container.textContent).toContain("1 violation");
    const showViol = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Show violations"),
    );
    showViol!.click();
    expect(onShowDsm).toHaveBeenCalled();
  });

  it("shows poor health styling for low modularity scores", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    panel.setResult(
      makeResult(
        makeDsm({
          metrics: { ...makeDsm().metrics, healthScore: 20 },
        }),
      ),
    );
    expect(
      container.querySelector("#modularity-health-section .health-poor"),
    ).toBeTruthy();
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
    expect(
      container.querySelector(".analysis-run-stream")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(container.textContent).toContain("Finding one");
  });

  it("hides the AI text box until an AI conversation starts", () => {
    const container = document.createElement("div");
    const panel = createResultsPanel(container);
    panel.setRuns([
      {
        id: "run-1",
        label: "Run #1",
        startedAt: Date.now(),
        status: "running",
        progress: {
          analysisId: "run-1",
          stage: "scanning",
          message: "Scanning…",
          current: 1,
          total: 4,
          percent: 25,
        },
        ruleTasks: [],
        result: null,
        error: null,
      },
    ]);

    const stream = container.querySelector(".analysis-run-stream");
    expect(stream).toBeTruthy();
    expect(stream?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector(".analysis-run-card.has-ai-stream")).toBeNull();
    expect(container.textContent).not.toContain(
      "AI output will appear here during validation",
    );
  });

  it("renders architecture health and switches percentile view", async () => {
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
    await vi.waitFor(() => {
      expect(container.querySelector(".paged-grid-pager")).toBeTruthy();
    });

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

  it("lazy-loads quality.files only when File ratings is opened", async () => {
    const container = document.createElement("div");
    const full = makeQuality();
    const slim = {
      files: {},
      packages: full.packages,
    };
    let result = makeResult(makeDsm(), { quality: slim });
    const onRequestQualityFiles = vi.fn(async () => {
      result = { ...result, quality: full };
      panel.setResult(result);
      return full;
    });
    const panel = createResultsPanel(container, { onRequestQualityFiles });
    panel.setResult(result);

    expect(container.textContent).toContain("File ratings");
    // Package ratings first paint must not pull the full file blob.
    expect(onRequestQualityFiles).not.toHaveBeenCalled();

    const fileTab = [...container.querySelectorAll(".arch-ratings-subtab")].find(
      (b) => b.textContent?.includes("File ratings"),
    ) as HTMLButtonElement;
    fileTab.click();
    await vi.waitFor(() => {
      expect(onRequestQualityFiles).toHaveBeenCalledOnce();
    });

    await vi.waitFor(() => {
      expect(Object.keys(result.quality?.files ?? {}).length).toBe(2);
    });

    // After hydration, open File ratings again and wait for deferred paint.
    const fileTab2 = [...container.querySelectorAll(".arch-ratings-subtab")].find(
      (b) => b.textContent?.includes("File ratings"),
    ) as HTMLButtonElement;
    fileTab2.click();
    await vi.waitFor(() => {
      expect(container.querySelectorAll(".arch-rating-card").length).toBeGreaterThan(0);
    });
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
