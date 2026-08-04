import { describe, expect, it } from "vitest";
import type { HierarchyIndex } from "./types";
import { countSymbolsByKind, fileSymbolCounts } from "./symbolCounts";

describe("countSymbolsByKind", () => {
  it("buckets functions, variables, and structures", () => {
    const counts = countSymbolsByKind([
      { id: "1", label: "fn", kind: "function", file: "a.ts", line: 1 },
      { id: "2", label: "m", kind: "method", file: "a.ts", line: 2 },
      { id: "3", label: "x", kind: "const", file: "a.ts", line: 3 },
      { id: "4", label: "C", kind: "class", file: "a.ts", line: 4 },
      { id: "5", label: "T", kind: "trait", file: "a.ts", line: 5 },
      { id: "6", label: "?", kind: "symbol", file: "a.ts", line: 6 },
    ]);
    expect(counts).toEqual({ functions: 2, variables: 1, structures: 2 });
  });
});

describe("fileSymbolCounts", () => {
  const base: HierarchyIndex = {
    files: [],
    packages: [],
    file_imports: {},
    package_edges: [],
    symbols: {},
    symbol_edges: [],
  };

  it("prefers persisted symbol_counts", () => {
    const hierarchy: HierarchyIndex = {
      ...base,
      symbol_counts: {
        "a.ts": { functions: 3, variables: 1, structures: 2 },
      },
      symbols: {
        "a.ts": [
          { id: "1", label: "f", kind: "function", file: "a.ts", line: 1 },
        ],
      },
    };
    expect(fileSymbolCounts(hierarchy, "a.ts")).toEqual({
      functions: 3,
      variables: 1,
      structures: 2,
    });
  });

  it("falls back to counting in-memory symbols", () => {
    const hierarchy: HierarchyIndex = {
      ...base,
      symbols: {
        "a.ts": [
          { id: "1", label: "f", kind: "function", file: "a.ts", line: 1 },
          { id: "2", label: "v", kind: "variable", file: "a.ts", line: 2 },
        ],
      },
    };
    expect(fileSymbolCounts(hierarchy, "a.ts")).toEqual({
      functions: 1,
      variables: 1,
      structures: 0,
    });
  });

  it("returns null when no data is available", () => {
    expect(fileSymbolCounts(base, "missing.ts")).toBeNull();
    expect(fileSymbolCounts(null, "a.ts")).toBeNull();
  });
});
