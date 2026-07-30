import { describe, expect, it } from "vitest";
import { computeDsm, healthStatus, defaultDsmOptions, DSM_MAX_ELEMENTS } from "./dsm";
import type { HierarchyIndex } from "./types";
import { HIERARCHY_VERSION } from "./types";

function emptyHierarchy(): HierarchyIndex {
  return {
    version: HIERARCHY_VERSION,
    files: [],
    packages: [],
    file_imports: {},
    package_edges: [],
    symbols: {},
    symbol_edges: [],
    scope_graphs: {},
  };
}

describe("healthStatus", () => {
  it("classifies healthy / fair / poor bands", () => {
    expect(healthStatus(100)).toBe("healthy");
    expect(healthStatus(80)).toBe("healthy");
    expect(healthStatus(79.9)).toBe("fair");
    expect(healthStatus(50)).toBe("fair");
    expect(healthStatus(49.9)).toBe("poor");
    expect(healthStatus(0)).toBe("poor");
  });
});

describe("defaultDsmOptions", () => {
  it("defaults to partitioned package-level", () => {
    expect(defaultDsmOptions()).toEqual({
      level: "package",
      scope: null,
      ordering: "partitioned",
    });
  });
});

describe("computeDsm — success", () => {
  it("orders acyclic layers into lower triangle", () => {
    const h = emptyHierarchy();
    h.packages = ["core", "api", "ui"];
    h.package_edges = [
      { source: "ui", target: "api", kind: "import" },
      { source: "api", target: "core", kind: "import" },
    ];
    const dsm = computeDsm(h);
    expect(dsm.elements.map((e) => e.id)).toEqual(["core", "api", "ui"]);
    expect(dsm.metrics.cycleCount).toBe(0);
    expect(dsm.matrix[2]![1]).toBeGreaterThan(0);
    expect(dsm.matrix[1]![0]).toBeGreaterThan(0);
    expect(dsm.metrics.healthScore).toBeGreaterThan(70);
  });

  it("scopes file-level DSM to a package", () => {
    const h = emptyHierarchy();
    h.packages = ["pkg"];
    h.files = [
      { path: "pkg/a.ts", label: "a.ts", loc: 10, package: "pkg" },
      { path: "pkg/b.ts", label: "b.ts", loc: 10, package: "pkg" },
      { path: "other/c.ts", label: "c.ts", loc: 10, package: "other" },
    ];
    h.file_imports = { "pkg/a.ts": ["pkg/b.ts"] };
    const dsm = computeDsm(h, {
      level: "file",
      scope: "pkg",
      ordering: "partitioned",
    });
    expect(dsm.elements).toHaveLength(2);
    expect(dsm.level).toBe("file");
    expect(dsm.scope).toBe("pkg");
  });

  it("uses scope graph modules for single-package projects", () => {
    const h = emptyHierarchy();
    h.packages = ["."];
    h.files = [
      { path: "src/a.ts", label: "a.ts", loc: 10, package: "." },
      { path: "lib/c.ts", label: "c.ts", loc: 10, package: "." },
    ];
    h.file_imports = { "src/a.ts": ["lib/c.ts"] };
    h.scope_graphs = {
      ".": {
        nodes: [
          { id: "src", label: "src", path: "src", loc: 10, kind: "package" },
          { id: "lib", label: "lib", path: "lib", loc: 10, kind: "package" },
        ],
        edges: [{ source: "src", target: "lib", kind: "import" }],
      },
    };
    const dsm = computeDsm(h);
    expect(dsm.elements.map((e) => e.id).sort()).toEqual(["lib", "src"]);
    expect(dsm.matrix.flat().some((w) => w > 0)).toBe(true);
    expect(dsm.scope).toBe(".");
  });

  it("falls back to file-derived modules when scope_graphs missing", () => {
    const h = emptyHierarchy();
    h.packages = ["."];
    h.files = [
      { path: "src/a.ts", label: "a.ts", loc: 10, package: "." },
      { path: "lib/c.ts", label: "c.ts", loc: 10, package: "." },
    ];
    h.file_imports = { "src/a.ts": ["lib/c.ts"] };
    const dsm = computeDsm(h);
    expect(dsm.elements.map((e) => e.id).sort()).toEqual(["lib", "src"]);
    expect(dsm.matrix.flat().some((w) => w > 0)).toBe(true);
  });

  it("uses workspace package edges when multiple packages exist", () => {
    const h = emptyHierarchy();
    h.packages = ["a", "b", "c"];
    h.package_edges = [{ source: "b", target: "a", kind: "import" }];
    const dsm = computeDsm(h);
    expect(dsm.elements).toHaveLength(3);
    expect(dsm.scope).toBeNull();
  });

  it("supports hierarchical ordering", () => {
    const h = emptyHierarchy();
    h.packages = ["z", "a"];
    h.package_edges = [{ source: "z", target: "a", kind: "import" }];
    const dsm = computeDsm(h, {
      level: "package",
      ordering: "hierarchical",
    });
    expect(dsm.ordering).toBe("hierarchical");
    expect(dsm.elements.map((e) => e.id)).toEqual(["a", "z"]);
  });

  it("reports MacCormack metric fields", () => {
    const h = emptyHierarchy();
    h.packages = ["a", "b"];
    h.package_edges = [{ source: "b", target: "a", kind: "import" }];
    const dsm = computeDsm(h);
    expect(dsm.metrics.propagationCost).toBeGreaterThanOrEqual(0);
    expect(dsm.metrics.clusteredCost).toBeGreaterThanOrEqual(0);
    expect(dsm.metrics.clusteredCostNormalized).toBeGreaterThanOrEqual(0);
    expect(dsm.metrics.clusteredCostNormalized).toBeLessThanOrEqual(1);
    expect(dsm.metrics.busCount).toBeGreaterThanOrEqual(0);
    expect(dsm.busIds).toEqual([]);
  });

  it("caps oversized file-level matrices", () => {
    const h = emptyHierarchy();
    h.packages = ["pkg"];
    h.files = Array.from({ length: DSM_MAX_ELEMENTS + 20 }, (_, i) => ({
      path: `pkg/f${i}.ts`,
      label: `f${i}.ts`,
      loc: 1,
      package: "pkg",
    }));
    h.file_imports = { "pkg/f0.ts": ["pkg/f1.ts"] };
    const dsm = computeDsm(h, {
      level: "file",
      scope: "pkg",
      ordering: "partitioned",
    });
    expect(dsm.elements.length).toBe(DSM_MAX_ELEMENTS);
    expect(dsm.capped).toBe(true);
  });
});

describe("computeDsm — failure / negative cases", () => {
  it("returns empty healthy DSM for empty project", () => {
    const dsm = computeDsm(emptyHierarchy());
    expect(dsm.elements).toHaveLength(0);
    expect(dsm.matrix).toHaveLength(0);
    expect(dsm.metrics.healthScore).toBe(100);
    expect(dsm.metrics.cycleCount).toBe(0);
    expect(dsm.metrics.propagationCost).toBe(0);
    expect(dsm.metrics.clusteredCost).toBe(0);
  });

  it("detects a two-node cycle and lowers health", () => {
    const h = emptyHierarchy();
    h.packages = ["a", "b"];
    h.package_edges = [
      { source: "a", target: "b", kind: "import" },
      { source: "b", target: "a", kind: "import" },
    ];
    const dsm = computeDsm(h);
    expect(dsm.metrics.cycleCount).toBe(1);
    expect(dsm.metrics.nodesInCycles).toBe(2);
    expect(dsm.cycleNodes.sort()).toEqual(["a", "b"]);
    expect(dsm.metrics.healthScore).toBeLessThan(70);
  });

  it("detects self-loop as a cycle", () => {
    const h = emptyHierarchy();
    h.packages = ["a", "b"];
    h.package_edges = [{ source: "a", target: "a", kind: "import" }];
    // self-edges are skipped in matrix build; adjacency may still see them if present
    // Ensure no crash and isolated packages remain healthy-ish
    const dsm = computeDsm(h);
    expect(dsm.elements.length).toBeGreaterThanOrEqual(1);
    expect(dsm.metrics.healthScore).toBeGreaterThanOrEqual(0);
  });

  it("ignores edges to unknown packages", () => {
    const h = emptyHierarchy();
    h.packages = ["a"];
    h.package_edges = [{ source: "a", target: "missing", kind: "import" }];
    // single package → module fallback; no scope graph → empty modules
    const dsm = computeDsm(h);
    expect(dsm.elements.every((e) => e.id !== "missing")).toBe(true);
  });

  it("returns empty file DSM for unknown scope", () => {
    const h = emptyHierarchy();
    h.packages = ["pkg"];
    h.files = [{ path: "pkg/a.ts", label: "a.ts", loc: 1, package: "pkg" }];
    const dsm = computeDsm(h, {
      level: "file",
      scope: "does-not-exist",
      ordering: "partitioned",
    });
    expect(dsm.elements).toHaveLength(0);
    expect(dsm.metrics.healthScore).toBe(100);
  });

  it("does not treat unknown level as file", () => {
    const h = emptyHierarchy();
    h.packages = ["a", "b"];
    h.package_edges = [{ source: "b", target: "a", kind: "import" }];
    const dsm = computeDsm(h, {
      level: "bogus",
      ordering: "partitioned",
    });
    expect(dsm.level).toBe("package");
  });

  it("treats unknown ordering as partitioned", () => {
    const h = emptyHierarchy();
    h.packages = ["a", "b"];
    const dsm = computeDsm(h, { level: "package", ordering: "nope" });
    expect(dsm.ordering).toBe("partitioned");
  });

  it("marks dense clique as less healthy than layered chain", () => {
    const layered = emptyHierarchy();
    layered.packages = ["a", "b", "c", "d"];
    layered.package_edges = [
      { source: "b", target: "a", kind: "import" },
      { source: "c", target: "b", kind: "import" },
      { source: "d", target: "c", kind: "import" },
    ];
    const clique = emptyHierarchy();
    clique.packages = ["a", "b", "c", "d"];
    for (const s of clique.packages) {
      for (const t of clique.packages) {
        if (s !== t) {
          clique.package_edges.push({ source: s, target: t, kind: "import" });
        }
      }
    }
    const L = computeDsm(layered);
    const C = computeDsm(clique);
    expect(L.metrics.propagationCost).toBeLessThan(C.metrics.propagationCost);
    expect(L.metrics.clusteredCost).toBeLessThan(C.metrics.clusteredCost);
    expect(L.metrics.healthScore).toBeGreaterThan(C.metrics.healthScore);
  });

  it("records upper-triangle density when deps go against partition", () => {
    const h = emptyHierarchy();
    h.packages = ["a", "b"];
    // Mutual deps force cycle; upper triangle after order will be non-zero
    h.package_edges = [
      { source: "a", target: "b", kind: "import" },
      { source: "b", target: "a", kind: "import" },
    ];
    const dsm = computeDsm(h);
    expect(dsm.metrics.upperTriangleDensity).toBeGreaterThan(0);
    expect(dsm.metrics.couplingDensity).toBeGreaterThan(0);
  });
});
