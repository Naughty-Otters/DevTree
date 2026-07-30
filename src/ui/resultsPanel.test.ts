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
});
