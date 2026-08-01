import { describe, expect, it } from "vitest";
import type { QualityIndex } from "./types";
import { qualityReportFromIndex } from "./qualityIndex";

function sampleIndex(): QualityIndex {
  return {
    files: {
      "pkg/a.ts": {
        path: "pkg/a.ts",
        package: "pkg",
        loc: 40,
        cyclomatic: 5,
        structural: 4,
        halsteadVolume: 120,
        halsteadDifficulty: 2,
        cognitive: 6,
        maintainability: 70,
        dit: 1,
        cbo: 2,
        coverage: 100,
        issueDensity: 0,
        securityDensity: 0,
        aiDensity: 0,
        duplicationHits: 0,
      },
    },
    packages: {
      pkg: {
        path: "pkg",
        fileCount: 1,
        totalLoc: 40,
        complexity: {
          avg: 5,
          percentiles: { p50: 5, p80: 5, p90: 5 },
        },
        halstead: {
          avg: 120,
          percentiles: { p50: 120, p80: 120, p90: 120 },
        },
        cognitive: {
          avg: 6,
          percentiles: { p50: 6, p80: 6, p90: 6 },
        },
        maintainability: {
          avg: 70,
          percentiles: { p50: 70, p80: 70, p90: 70 },
        },
        cbo: { avg: 2, percentiles: { p50: 2, p80: 2, p90: 2 } },
        coverage: {
          avg: 100,
          percentiles: { p50: 100, p80: 100, p90: 100 },
        },
        issues: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
        security: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
        aiQuality: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
        duplication: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
        size: { avg: 40, percentiles: { p50: 40, p80: 40, p90: 40 } },
      },
    },
  };
}

describe("qualityReportFromIndex", () => {
  it("returns file metrics without recomputation", () => {
    const report = qualityReportFromIndex(sampleIndex(), {
      kind: "file",
      path: "pkg/a.ts",
    });
    expect(report?.kind).toBe("file");
    expect(report?.metrics.find((m) => m.id === "halstead")?.value).toBe(120);
    expect(report?.metrics.find((m) => m.id === "dit")?.value).toBe(1);
  });

  it("returns package rollups with percentiles", () => {
    const report = qualityReportFromIndex(sampleIndex(), {
      kind: "package",
      path: "pkg",
    });
    expect(report?.fileCount).toBe(1);
    expect(report?.metrics.find((m) => m.id === "complexity")?.percentiles?.p90).toBe(
      5,
    );
  });
});
