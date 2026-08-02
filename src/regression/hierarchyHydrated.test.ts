import { describe, expect, it } from "vitest";
import type { HierarchyIndex } from "../analysis/types";
import { hierarchyIsHydrated } from "./hierarchyHydrated";

function emptyHierarchy(): HierarchyIndex {
  return {
    files: [],
    packages: [],
    file_imports: {},
    package_edges: [],
    symbols: {},
    symbol_edges: [],
  };
}

describe("regression/hierarchyHydrated", () => {
  it("treats null and undefined as not hydrated", () => {
    expect(hierarchyIsHydrated(null)).toBe(false);
    expect(hierarchyIsHydrated(undefined)).toBe(false);
  });

  it("treats empty stubs as not hydrated (slim IPC / restore)", () => {
    expect(hierarchyIsHydrated(emptyHierarchy())).toBe(false);
  });

  it("is hydrated when packages exist even without files", () => {
    expect(
      hierarchyIsHydrated({
        ...emptyHierarchy(),
        packages: ["src"],
      }),
    ).toBe(true);
  });

  it("is hydrated when files exist even without packages", () => {
    expect(
      hierarchyIsHydrated({
        ...emptyHierarchy(),
        files: [{ path: "a.ts", label: "a.ts", loc: 1, package: "." }],
      }),
    ).toBe(true);
  });
});
