import { describe, expect, it } from "vitest";
import {
  __scoreHistoryChartTest,
  renderScoreHistoryCharts,
  renderScoreHistorySection,
} from "./scoreHistoryCharts";
import type { AnalysisScoreSnapshot } from "../analysis/scoreHistory";

function points(n: number): AnalysisScoreSnapshot[] {
  return Array.from({ length: n }, (_, i) => ({
    at: 1_700_000_000_000 + i * 86_400_000,
    overall: 60 + i,
    architecture: 70 + i,
    modularity: 50 + i,
    percentileView: "all",
    overallStats: {
      packages: 10 + i,
      files: 100 + i,
      rules: 5,
      passed: 3,
      warnings: 1 + i,
      failures: i,
    },
    architectureMetrics: {
      complexity: 80 - i,
      maintainability: 75,
      coverage: 70 + i,
    },
    modularityMetrics: {
      cycles: i,
      nodesInCycles: i * 2,
      upperTrianglePct: 5 + i,
      couplingPct: 10,
      propagationPct: 12,
      clusteredCostPct: 8,
      buses: 1,
    },
  }));
}

describe("scoreHistoryCharts", () => {
  it("shows empty state with fewer than 2 points", () => {
    const host = document.createElement("div");
    renderScoreHistoryCharts(host, []);
    expect(host.querySelector(".score-history-empty")?.textContent).toMatch(
      /more than once/i,
    );

    renderScoreHistoryCharts(host, points(1));
    expect(host.querySelector(".score-history-empty")?.textContent).toMatch(
      /One analysis/i,
    );
    expect(host.querySelector(".score-history-grid")).toBeNull();
  });

  it("renders three sections with metric pickers and SVG lines", () => {
    const host = document.createElement("div");
    renderScoreHistoryCharts(host, points(3));

    expect(host.querySelector(".score-history-heading")?.textContent).toBe(
      "Health over time",
    );
    const cards = host.querySelectorAll(".score-history-card");
    expect(cards.length).toBe(3);
    expect(host.querySelectorAll(".score-history-picker").length).toBe(3);
    expect(host.querySelectorAll("svg.score-history-svg").length).toBe(3);
    expect(host.querySelectorAll("polyline.score-history-line").length).toBeGreaterThan(
      0,
    );
    expect(host.querySelector(".score-history-chip.is-active")).toBeTruthy();
  });

  it("toggles metric chips and keeps at least one selected", () => {
    const host = document.createElement("div");
    renderScoreHistoryCharts(host, points(3));

    const activeCount = () =>
      host
        .querySelectorAll(".score-history-card")[0]!
        .querySelectorAll(".score-history-chip.is-active").length;

    expect(activeCount()).toBeGreaterThan(0);

    // Deselect until one remains.
    let guard = 20;
    while (activeCount() > 1 && guard-- > 0) {
      const active = host
        .querySelectorAll(".score-history-card")[0]!
        .querySelector<HTMLButtonElement>(".score-history-chip.is-active")!;
      active.click();
    }
    expect(activeCount()).toBe(1);

    // Cannot deselect the last chip.
    const last = host
      .querySelectorAll(".score-history-card")[0]!
      .querySelector<HTMLButtonElement>(".score-history-chip.is-active")!;
    last.click();
    expect(activeCount()).toBe(1);
  });

  it("renders a single embedded section chart", () => {
    const host = document.createElement("div");
    renderScoreHistorySection(host, "architecture", points(3), {
      embedded: true,
    });
    expect(host.classList.contains("score-history-embedded")).toBe(true);
    expect(host.querySelector(".score-history-heading-embedded")?.textContent).toBe(
      "Architecture health over time",
    );
    expect(host.querySelector(".score-history-toggle")).toBeTruthy();
    expect(host.querySelectorAll(".score-history-card").length).toBe(1);
    expect(host.querySelector(".score-history-card-title")).toBeNull();
    expect(host.querySelector("svg.score-history-svg")).toBeTruthy();
  });

  it("collapses and expands a chart via the chevron", () => {
    localStorage.removeItem("devtree-score-chart-collapsed");
    const host = document.createElement("div");
    renderScoreHistorySection(host, "overall", points(3), { embedded: true });

    const toggle = host.querySelector<HTMLButtonElement>(".score-history-toggle")!;
    expect(host.classList.contains("is-collapsed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".score-history-body")).toBeTruthy();

    toggle.click();
    expect(host.classList.contains("is-collapsed")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    expect(host.classList.contains("is-collapsed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a datapoint tooltip on chart hover", () => {
    localStorage.removeItem("devtree-score-chart-selection");
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderScoreHistorySection(host, "overall", points(3), { embedded: true });

    const wrap = host.querySelector<HTMLElement>(".score-history-chart-wrap")!;
    const svg = host.querySelector<SVGSVGElement>("svg.score-history-svg")!;
    const tip = host.querySelector<HTMLElement>(".score-history-tooltip")!;
    expect(tip.classList.contains("hidden")).toBe(true);
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");

    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 320,
        height: 110,
        right: 320,
        bottom: 110,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    });
    Object.defineProperty(wrap, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 320,
        height: 110,
        right: 320,
        bottom: 110,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    });
    // jsdom has no CTM; force the fallback path used when getScreenCTM is null.
    Object.defineProperty(svg, "getScreenCTM", { value: () => null });

    wrap.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 40, bubbles: true }),
    );
    expect(wrap.dataset.hoverIndex).toBe("0");
    expect(tip.classList.contains("hidden")).toBe(false);
    expect(tip.querySelector(".score-history-tooltip-date")).toBeTruthy();
    expect(tip.querySelectorAll(".score-history-tooltip-row").length).toBeGreaterThan(
      0,
    );

    wrap.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 160, clientY: 40, bubbles: true }),
    );
    expect(wrap.dataset.hoverIndex).toBe("1");

    wrap.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 310, clientY: 40, bubbles: true }),
    );
    expect(wrap.dataset.hoverIndex).toBe("2");

    wrap.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(tip.classList.contains("hidden")).toBe(true);
    host.remove();
  });

  it("maps hover X evenly by run index even when timestamps cluster", () => {
    const geom = __scoreHistoryChartTest.chartGeometry(3, 320, 110, 10, 12, 0, 100);
    expect(__scoreHistoryChartTest.nearestPointIndex(10, 3, geom.xAt)).toBe(0);
    expect(__scoreHistoryChartTest.nearestPointIndex(160, 3, geom.xAt)).toBe(1);
    expect(__scoreHistoryChartTest.nearestPointIndex(310, 3, geom.xAt)).toBe(2);
  });

  it("exposes section metric catalogs", () => {
    expect(__scoreHistoryChartTest.SECTIONS.map((s) => s.id)).toEqual([
      "overall",
      "architecture",
      "modularity",
    ]);
    expect(
      __scoreHistoryChartTest.SECTIONS[0]!.metrics.some((m) => m.id === "failures"),
    ).toBe(true);
  });
});
