import { describe, expect, it } from "vitest";
import type { QualityIndex } from "./types";
import { qualityReportFromIndex } from "./qualityIndex";

function sampleIndex(): QualityIndex {
  const rollup = (avg: number) => ({
    avg,
    percentiles: { p50: avg, p80: avg, p90: avg },
  });
  return {
    files: {
      "pkg/a.ts": {
        path: "pkg/a.ts",
        package: "pkg",
        loc: 40,
        nloc: 30,
        cloc: 6,
        codeDensity: 75,
        commentDensity: 16.7,
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
        duplicatedPct: 4,
        deadCodePct: 12,
        staleDecisionDensity: 2.5,
      },
    },
    packages: {
      pkg: {
        path: "pkg",
        fileCount: 1,
        totalLoc: 40,
        totalNloc: 30,
        totalCloc: 6,
        complexity: rollup(5),
        halstead: rollup(120),
        cognitive: rollup(6),
        maintainability: rollup(70),
        cbo: rollup(2),
        coverage: rollup(100),
        issues: rollup(0),
        security: rollup(0),
        aiQuality: rollup(0),
        duplication: rollup(0),
        duplicatedCode: rollup(4),
        nloc: rollup(30),
        cloc: rollup(6),
        codeDensity: rollup(75),
        commentDensity: rollup(16.7),
        deadCode: rollup(12),
        staleDecisions: rollup(2.5),
        size: rollup(40),
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
    expect(report?.metrics.find((m) => m.id === "nloc")?.value).toBe(30);
    expect(report?.metrics.find((m) => m.id === "cloc")?.value).toBe(6);
    expect(report?.metrics.find((m) => m.id === "duplicatedCode")?.value).toBe(4);
    expect(report?.metrics.find((m) => m.id === "deadCode")?.value).toBe(12);
    expect(report?.metrics.find((m) => m.id === "staleDecisions")?.value).toBe(
      2.5,
    );
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
    expect(report?.metrics.find((m) => m.id === "codeDensity")?.value).toBe(75);
    expect(report?.metrics.find((m) => m.id === "commentDensity")?.value).toBe(
      16.7,
    );
  });
});
