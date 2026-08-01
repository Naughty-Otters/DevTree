import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, HierarchyIndex } from "../analysis/types";

const hydrated: HierarchyIndex = {
  files: [{ path: "a.ts", label: "a.ts", loc: 3, package: "." }],
  packages: ["."],
  file_imports: {},
  package_edges: [],
  symbols: {},
  symbol_edges: [],
};

describe("lazy/hierarchy", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("clears hierarchy load cache without error", async () => {
    const { clearHierarchyLoadCache } = await import("./hierarchy");
    expect(() => clearHierarchyLoadCache()).not.toThrow();
  });

  it("returns hydrated in-memory hierarchy without hitting storage", async () => {
    const { loadAnalysisHierarchy } = await import("./hierarchy");
    const result = { hierarchy: hydrated } as AnalysisResult;
    await expect(loadAnalysisHierarchy(result)).resolves.toEqual(hydrated);
  });

  it("does not treat empty hierarchy as hydrated — loads from storage", async () => {
    const { savePersistedState } = await import("../state/store");
    const { defaultPersistedState } = await import("../state/types");
    await savePersistedState({
      ...defaultPersistedState(),
      analysisResult: {
        graph: { nodes: [], edges: [] },
        hierarchy: hydrated,
        validation: [],
        suggestions: [],
        summary: "",
      },
    });

    const { clearHierarchyLoadCache, loadAnalysisHierarchy } = await import(
      "./hierarchy"
    );
    clearHierarchyLoadCache();
    const empty: HierarchyIndex = {
      files: [],
      packages: [],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    };
    const loaded = await loadAnalysisHierarchy({
      graph: { nodes: [], edges: [] },
      hierarchy: empty,
      validation: [],
      suggestions: [],
      summary: "",
    });
    expect(loaded?.files).toHaveLength(1);
    expect(loaded?.files[0]?.path).toBe("a.ts");
  });
});
