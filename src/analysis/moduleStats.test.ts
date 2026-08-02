import { describe, expect, it } from "vitest";
import type { HierarchyIndex } from "./types";
import {
  computeFileStats,
  computePackageStats,
  fileSizeHealth,
  locPercentiles,
  packageSizeHealth,
  percentile,
  percentileRank,
} from "./moduleStats";

function hierarchy(locs: Array<{ path: string; loc: number; pkg?: string }>): HierarchyIndex {
  return {
    files: locs.map((f) => ({
      path: f.path,
      label: f.path.split("/").pop() ?? f.path,
      loc: f.loc,
      package: f.pkg ?? f.path.split("/")[0] ?? ".",
    })),
    packages: [...new Set(locs.map((f) => f.pkg ?? f.path.split("/")[0] ?? "."))],
    file_imports: {},
    package_edges: [],
    symbols: {},
    symbol_edges: [],
  };
}

describe("percentile", () => {
  it("returns nearest-rank percentiles", () => {
    const sample = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sample, 50)).toBe(50);
    expect(percentile(sample, 80)).toBe(80);
    expect(percentile(sample, 90)).toBe(90);
  });

  it("handles single-value samples", () => {
    expect(locPercentiles([42])).toEqual({ p50: 42, p80: 42, p90: 42 });
  });
});

describe("size health bands", () => {
  it("classifies package p90 bands", () => {
    expect(packageSizeHealth(200)).toBe("healthy");
    expect(packageSizeHealth(250)).toBe("fair");
    expect(packageSizeHealth(301)).toBe("poor");
  });

  it("classifies file percentile ranks", () => {
    expect(fileSizeHealth(40)).toBe("healthy");
    expect(fileSizeHealth(80)).toBe("fair");
    expect(fileSizeHealth(91)).toBe("poor");
  });
});

describe("computePackageStats", () => {
  it("counts files and reports p50/p80/p90", () => {
    const h = hierarchy([
      { path: "pkg/a.ts", loc: 10, pkg: "pkg" },
      { path: "pkg/b.ts", loc: 20, pkg: "pkg" },
      { path: "pkg/c.ts", loc: 30, pkg: "pkg" },
      { path: "pkg/d.ts", loc: 40, pkg: "pkg" },
      { path: "pkg/e.ts", loc: 200, pkg: "pkg" },
      { path: "other/x.ts", loc: 999, pkg: "other" },
    ]);

    const stats = computePackageStats(h, "pkg");
    expect(stats.fileCount).toBe(5);
    expect(stats.totalLoc).toBe(300);
    expect(stats.percentiles.p50).toBe(30);
    expect(stats.percentiles.p80).toBe(40);
    expect(stats.percentiles.p90).toBe(200);
    expect(stats.health).toBe("healthy");
  });
});

describe("computeFileStats", () => {
  it("ranks a file among package peers", () => {
    const h = hierarchy([
      { path: "pkg/a.ts", loc: 10, pkg: "pkg" },
      { path: "pkg/b.ts", loc: 20, pkg: "pkg" },
      { path: "pkg/c.ts", loc: 100, pkg: "pkg" },
    ]);

    const mid = computeFileStats(h, "pkg/b.ts");
    expect(mid.loc).toBe(20);
    expect(mid.peerScope).toBe("package");
    expect(mid.percentile).toBe(percentileRank([10, 20, 100], 20));
    expect(mid.health).toBe("fair");

    const large = computeFileStats(h, "pkg/c.ts");
    expect(large.percentile).toBe(100);
    expect(large.health).toBe("poor");
  });
});
