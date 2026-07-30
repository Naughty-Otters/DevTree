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

function makeResult(dsm: DsmResult | null): AnalysisResult {
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
