import { describe, expect, it, vi } from "vitest";
import { createDsmView } from "./dsmView";
import type { HierarchyIndex } from "../analysis/types";
import { HIERARCHY_VERSION } from "../analysis/types";
import { rootNavigation, drillIntoPackage } from "../graph/navigation";
import type { DsmResult } from "../analysis/dsm";

function hierarchyWithModules(): HierarchyIndex {
  return {
    version: HIERARCHY_VERSION,
    files: [
      { path: "src/a.ts", label: "a.ts", loc: 10, package: "." },
      { path: "lib/b.ts", label: "b.ts", loc: 10, package: "." },
    ],
    packages: ["."],
    file_imports: { "src/a.ts": ["lib/b.ts"] },
    package_edges: [],
    symbols: {},
    symbol_edges: [],
    scope_graphs: {
      ".": {
        nodes: [
          { id: "src", label: "src", path: "src", loc: 10, kind: "package" },
          { id: "lib", label: "lib", path: "lib", loc: 10, kind: "package" },
        ],
        edges: [{ source: "src", target: "lib", kind: "import" }],
      },
    },
  };
}

function sampleDsm(): DsmResult {
  return {
    level: "package",
    scope: ".",
    ordering: "partitioned",
    elements: [
      { id: "lib", label: "lib" },
      { id: "src", label: "src" },
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
      clusteredCost: 4,
      clusteredCostNormalized: 0.25,
      busCount: 0,
      healthScore: 88,
    },
    cycleNodes: [],
    busIds: [],
    violations: [],
    capped: false,
  };
}

describe("createDsmView", () => {
  it("creates empty state without throwing", () => {
    const container = document.createElement("div");
    expect(() => createDsmView(container)).not.toThrow();
    expect(container.classList.contains("dsm-view")).toBe(true);
    expect(container.textContent).toContain("Design Structure Matrix");
  });

  it("shows a loading placeholder while hierarchy hydrates", () => {
    const container = document.createElement("div");
    const view = createDsmView(container);
    view.setLoading("Loading Design Structure Matrix…");
    expect(container.querySelector(".loading-placeholder")).toBeTruthy();
    expect(container.textContent).toContain("Loading Design Structure Matrix");
    view.setLoading(null);
    expect(container.querySelector(".loading-placeholder")).toBeNull();
  });

  it("renders a matrix from hierarchy", () => {
    const container = document.createElement("div");
    const view = createDsmView(container);
    view.setData(hierarchyWithModules(), rootNavigation(), {
      level: "package",
      ordering: "partitioned",
    });
    expect(container.querySelector(".dsm-matrix")).toBeTruthy();
    expect(container.textContent).toContain("Health");
    expect(container.querySelector(".dsm-empty")?.hasAttribute("hidden") ||
      (container.querySelector(".dsm-empty") as HTMLElement)?.hidden).toBe(true);
  });

  it("uses preferred DSM when options match", () => {
    const container = document.createElement("div");
    const view = createDsmView(container);
    const preferred = sampleDsm();
    view.setData(
      hierarchyWithModules(),
      rootNavigation(),
      { level: "package", ordering: "partitioned" },
      preferred,
    );
    expect(container.querySelectorAll(".dsm-row-header").length).toBe(2);
    expect(container.textContent).toContain("88");
  });

  it("calls onShowOnGraph", () => {
    const container = document.createElement("div");
    const onShowOnGraph = vi.fn();
    createDsmView(container, { onShowOnGraph });
    const btn = container.querySelector(".dsm-show-graph") as HTMLButtonElement;
    btn.click();
    expect(onShowOnGraph).toHaveBeenCalled();
  });

  it("fires onOptionsChange when level changes", () => {
    const container = document.createElement("div");
    const onOptionsChange = vi.fn();
    const view = createDsmView(container, { onOptionsChange });
    view.setData(hierarchyWithModules(), rootNavigation(), {
      level: "package",
      ordering: "partitioned",
    });
    const selects = container.querySelectorAll("select");
    const levelSelect = selects[0] as HTMLSelectElement;
    levelSelect.value = "file";
    levelSelect.dispatchEvent(new Event("change"));
    expect(onOptionsChange).toHaveBeenCalled();
    expect(onOptionsChange.mock.calls[0]![0].level).toBe("file");
  });

  it("highlights selected elements", () => {
    const container = document.createElement("div");
    const view = createDsmView(container);
    view.setData(
      hierarchyWithModules(),
      rootNavigation(),
      { level: "package", ordering: "partitioned" },
      sampleDsm(),
    );
    view.highlight(["src"]);
    expect(container.querySelector(".dsm-highlight, .dsm-cycle")).toBeTruthy();
  });

  it("calls onSelectElement when row header clicked", () => {
    const container = document.createElement("div");
    const onSelectElement = vi.fn();
    const view = createDsmView(container, { onSelectElement });
    view.setData(
      hierarchyWithModules(),
      rootNavigation(),
      { level: "package", ordering: "partitioned" },
      sampleDsm(),
    );
    const row = container.querySelector(".dsm-row-header") as HTMLElement;
    row.click();
    expect(onSelectElement).toHaveBeenCalled();
  });

  it("shows empty modules message for empty hierarchy packages", () => {
    const container = document.createElement("div");
    const view = createDsmView(container);
    view.setData(
      {
        version: HIERARCHY_VERSION,
        files: [],
        packages: [],
        file_imports: {},
        package_edges: [],
        symbols: {},
        symbol_edges: [],
      },
      rootNavigation(),
      { level: "package", ordering: "partitioned" },
    );
    expect(container.textContent).toMatch(/No modules|Run analysis/);
  });

  it("follows package navigation scope", () => {
    const container = document.createElement("div");
    const view = createDsmView(container);
    const nav = drillIntoPackage(rootNavigation(), "src", "src");
    view.setData(hierarchyWithModules(), nav, {
      level: "package",
      ordering: "partitioned",
    });
    const opts = view.getOptions();
    expect(opts.scope).toBe("src");
  });

  it("marks violation cells", () => {
    const container = document.createElement("div");
    const view = createDsmView(container);
    const preferred = sampleDsm();
    preferred.violations = [
      { ruleId: "L1", from: "src", to: "lib", message: "forbidden" },
    ];
    view.setData(
      hierarchyWithModules(),
      rootNavigation(),
      { level: "package", ordering: "partitioned" },
      preferred,
    );
    expect(container.querySelector(".dsm-cell-violation")).toBeTruthy();
  });
});
