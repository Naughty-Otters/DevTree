import { describe, expect, it } from "vitest";
import * as api from "./api";

describe("project/api", () => {
  it("exports project API helpers", () => {
    expect(typeof api.scanProject).toBe("function");
    expect(typeof api.openProjectDialog).toBe("function");
  });

  it("exports lazy hierarchy/quality loaders used after slim IPC", () => {
    expect(typeof api.loadAnalysisHierarchyLite).toBe("function");
    expect(typeof api.loadAnalysisQualityFiles).toBe("function");
    expect(typeof api.listProjectChildren).toBe("function");
  });

  it("browser mock hierarchy-lite is empty (forces storage/cache path)", async () => {
    const lite = await api.loadAnalysisHierarchyLite("/tmp/mock-project");
    expect(lite.files).toEqual([]);
    expect(lite.symbol_edges).toEqual([]);
  });
});
