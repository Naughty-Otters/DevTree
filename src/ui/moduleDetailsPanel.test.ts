import { describe, expect, it, vi } from "vitest";
import type { HierarchyIndex } from "../analysis/types";
import { rootNavigation } from "../graph/navigation";
import type { GraphNode } from "../graph/types";
import {
  createModuleDetailsPanel,
  moduleContents,
} from "./moduleDetailsPanel";

function packageNode(id: string, label = id): GraphNode {
  return { id, label, path: id, loc: 10, kind: "package" };
}

describe("moduleContents", () => {
  it("returns child packages/files for a package module", () => {
    const hierarchy: HierarchyIndex = {
      files: [
        { path: "a/x.ts", label: "x.ts", loc: 3, package: "a" },
        { path: "a/y.ts", label: "y.ts", loc: 4, package: "a" },
      ],
      packages: ["a", "b"],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    };

    const contents = moduleContents(
      packageNode("a"),
      hierarchy,
      rootNavigation(),
    );
    expect(contents.map((n) => n.id).sort()).toEqual(["a/x.ts", "a/y.ts"]);
  });

  it("returns symbols for a file module", () => {
    const file: GraphNode = {
      id: "a/x.ts",
      label: "x.ts",
      path: "a/x.ts",
      loc: 3,
      kind: "file",
    };
    const hierarchy: HierarchyIndex = {
      files: [{ path: "a/x.ts", label: "x.ts", loc: 3, package: "a" }],
      packages: ["a"],
      file_imports: {},
      package_edges: [],
      symbols: {
        "a/x.ts": [
          {
            id: "a/x.ts#foo",
            label: "foo",
            file: "a/x.ts",
            kind: "function",
            line: 1,
          },
        ],
      },
      symbol_edges: [],
    };

    const contents = moduleContents(file, hierarchy, rootNavigation());
    expect(contents).toHaveLength(1);
    expect(contents[0]?.label).toBe("foo");
  });
});

describe("createModuleDetailsPanel", () => {
  it("slides open and closed", () => {
    const root = document.createElement("aside");
    const panel = createModuleDetailsPanel(root);
    const node = packageNode("pkg");

    panel.show({
      node,
      nodes: [node],
      edges: [],
      hierarchy: null,
      navigation: rootNavigation(),
    });

    expect(panel.isOpen()).toBe(true);
    expect(root.classList.contains("is-open")).toBe(true);
    expect(root.textContent).toContain("Depends on");
    expect(root.textContent).toContain("Used by");
    expect(root.textContent).toContain("Contents");

    panel.hide();
    expect(panel.isOpen()).toBe(false);
    expect(root.classList.contains("is-open")).toBe(false);
  });

  it("shows Codacy-style quality metrics with package percentiles", () => {
    const root = document.createElement("aside");
    const panel = createModuleDetailsPanel(root);
    const hierarchy: HierarchyIndex = {
      files: [
        { path: "pkg/a.ts", label: "a.ts", loc: 10, package: "pkg" },
        { path: "pkg/b.ts", label: "b.ts", loc: 20, package: "pkg" },
        { path: "pkg/c.ts", label: "c.ts", loc: 30, package: "pkg" },
      ],
      packages: ["pkg"],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    };

    panel.show({
      node: packageNode("pkg"),
      nodes: [packageNode("pkg")],
      edges: [],
      hierarchy,
      navigation: rootNavigation(),
      analysis: null,
    });

    expect(root.textContent).toContain("Quality metrics");
    expect(root.textContent).toContain("Complexity");
    expect(root.textContent).toContain("Halstead");
    expect(root.textContent).toContain("Cognitive");
    expect(root.textContent).toContain("Maintain.");
    expect(root.textContent).toContain("DIT");
    expect(root.textContent).toContain("CBO");
    expect(root.textContent).toContain("Churn");
    expect(root.textContent).toContain("Coverage");
    expect(root.textContent).toContain("Security");
    expect(root.textContent).toContain("Docs");
    expect(root.textContent).toContain("Duplication");
    expect(root.textContent).toContain("Issues");
    expect(root.textContent).toContain("AI quality");
    expect(root.textContent).toMatch(/Avgp50p80p90All/);
    expect(root.textContent).toMatch(/avg \d/);

    const metric = root.querySelector<HTMLElement>(".module-details-metric");
    expect(metric).toBeTruthy();
    expect(metric!.querySelector(".metric-info-mark")).toBeTruthy();
    metric!.click();
    const popup = document.querySelector<HTMLElement>(".metric-def-popup");
    expect(popup).toBeTruthy();
    expect(popup!.classList.contains("hidden")).toBe(false);
    expect(popup!.textContent).toMatch(/better|越好|cyclomatic|圈复杂度|CC\s*=/i);
    expect(popup!.querySelector(".metric-def-link")).toBeTruthy();
  });

  it("shows rating and switches percentile view from quality index", () => {
    const root = document.createElement("aside");
    let view: "avg" | "p50" | "p80" | "p90" | "all" = "all";
    const onPercentileViewChange = vi.fn((mode: typeof view) => {
      view = mode;
    });
    const panel = createModuleDetailsPanel(root, {
      getPercentileView: () => view,
      onPercentileViewChange,
    });

    const rollup = (avg: number) => ({
      avg,
      percentiles: { p50: avg, p80: avg, p90: avg * 2 },
    });
    const hierarchy: HierarchyIndex = {
      files: [
        { path: "pkg/a.ts", label: "a.ts", loc: 10, package: "pkg" },
        { path: "pkg/b.ts", label: "b.ts", loc: 40, package: "pkg" },
      ],
      packages: ["pkg"],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    };

    panel.show({
      node: packageNode("pkg"),
      nodes: [packageNode("pkg")],
      edges: [],
      hierarchy,
      navigation: rootNavigation(),
      analysis: {
        graph: { nodes: [], edges: [] },
        hierarchy,
        validation: [],
        suggestions: [],
        summary: "ok",
        quality: {
          files: {
            "pkg/a.ts": {
              path: "pkg/a.ts",
              package: "pkg",
              loc: 10,
              cyclomatic: 2,
              structural: 2,
              halsteadVolume: 40,
              halsteadDifficulty: 4,
              cognitive: 2,
              maintainability: 90,
              dit: 0,
              cbo: 1,
              coverage: 100,
              issueDensity: 0,
              securityDensity: 0,
              aiDensity: 0,
              duplicationHits: 0,
            },
            "pkg/b.ts": {
              path: "pkg/b.ts",
              package: "pkg",
              loc: 40,
              cyclomatic: 20,
              structural: 10,
              halsteadVolume: 400,
              halsteadDifficulty: 12,
              cognitive: 15,
              maintainability: 50,
              dit: 1,
              cbo: 4,
              coverage: 0,
              issueDensity: 2,
              securityDensity: 0,
              aiDensity: 0,
              duplicationHits: 0,
            },
          },
          packages: {
            pkg: {
              path: "pkg",
              fileCount: 2,
              totalLoc: 50,
              complexity: rollup(11),
              halstead: rollup(220),
              cognitive: rollup(8),
              maintainability: rollup(70),
              cbo: rollup(2),
              coverage: rollup(50),
              issues: rollup(1),
              security: rollup(0),
              aiQuality: rollup(0),
              duplication: rollup(0),
              size: rollup(25),
            },
          },
        },
      },
    });

    expect(root.textContent).toMatch(/Rating/);
    expect(root.textContent).toMatch(/\/100/);

    const p90 = [...root.querySelectorAll(".percentile-view-btn")].find(
      (b) => b.textContent === "p90",
    ) as HTMLButtonElement;
    p90.click();
    expect(onPercentileViewChange).toHaveBeenCalledWith("p90");
    expect(view).toBe("p90");
  });

  it("updates churn and classic metrics after enrichment", () => {
    const root = document.createElement("aside");
    const panel = createModuleDetailsPanel(root);
    const file: GraphNode = {
      id: "pkg/a.ts",
      label: "a.ts",
      path: "pkg/a.ts",
      loc: 40,
      kind: "file",
    };
    const hierarchy: HierarchyIndex = {
      files: [{ path: "pkg/a.ts", label: "a.ts", loc: 40, package: "pkg" }],
      packages: ["pkg"],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    };

    panel.show({
      node: file,
      nodes: [file],
      edges: [],
      hierarchy,
      navigation: rootNavigation(),
    });

    panel.updateQuality({
      churn: {
        available: true,
        days: 90,
        byPath: new Map([
          [
            "pkg/a.ts",
            {
              path: "pkg/a.ts",
              linesAdded: 12,
              linesDeleted: 3,
              commits: 2,
            },
          ],
        ]),
      },
    });

    expect(root.textContent).toContain("15");
    expect(root.textContent).toContain("lines/90d");
  });

  it("shows function, variable, and structure counts for file modules", () => {
    const root = document.createElement("aside");
    const panel = createModuleDetailsPanel(root);
    const file: GraphNode = {
      id: "pkg/a.ts",
      label: "a.ts",
      path: "pkg/a.ts",
      loc: 40,
      kind: "file",
    };
    const hierarchy: HierarchyIndex = {
      files: [{ path: "pkg/a.ts", label: "a.ts", loc: 40, package: "pkg" }],
      packages: ["pkg"],
      file_imports: {},
      package_edges: [],
      symbols: {
        "pkg/a.ts": [
          {
            id: "pkg/a.ts::main",
            label: "main",
            kind: "function",
            file: "pkg/a.ts",
            line: 1,
          },
          {
            id: "pkg/a.ts::x",
            label: "x",
            kind: "const",
            file: "pkg/a.ts",
            line: 2,
          },
          {
            id: "pkg/a.ts::App",
            label: "App",
            kind: "class",
            file: "pkg/a.ts",
            line: 10,
          },
        ],
      },
      symbol_edges: [],
    };

    panel.show({
      node: file,
      nodes: [file],
      edges: [],
      hierarchy,
      navigation: rootNavigation(),
    });

    expect(root.textContent).toContain("Functions");
    expect(root.textContent).toContain("Variables");
    expect(root.textContent).toContain("Structures");
    expect(root.textContent).toMatch(/Functions\s*1/);
    expect(root.textContent).toMatch(/Variables\s*1/);
    expect(root.textContent).toMatch(/Structures\s*1/);
  });
});
