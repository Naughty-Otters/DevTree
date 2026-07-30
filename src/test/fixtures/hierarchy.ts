import type { HierarchyIndex } from "../../analysis/types";
import { HIERARCHY_VERSION } from "../../analysis/types";

/** Small hierarchy fixture for graph/validation unit tests. */
export function minimalHierarchy(): HierarchyIndex {
  return {
    version: HIERARCHY_VERSION,
    files: [
      { path: "src/a.ts", label: "a.ts", loc: 10, package: "src" },
      { path: "src/b.ts", label: "b.ts", loc: 12, package: "src" },
      { path: "lib/c.ts", label: "c.ts", loc: 8, package: "lib" },
    ],
    packages: ["lib", "src"],
    file_imports: {
      "src/a.ts": ["src/b.ts"],
      "src/b.ts": ["src/a.ts"],
      "lib/c.ts": ["src/a.ts"],
    },
    package_edges: [{ source: "lib", target: "src", kind: "import" }],
    symbols: {
      "src/a.ts": [
        { id: "src/a.ts::main", label: "main", kind: "function", file: "src/a.ts", line: 1 },
      ],
      "src/b.ts": [
        { id: "src/b.ts::main", label: "main", kind: "function", file: "src/b.ts", line: 2 },
      ],
    },
    symbol_edges: [
      { source: "src/a.ts::main", target: "src/b.ts::main", kind: "reference" },
    ],
  };
}
