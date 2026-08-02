import { describe, expect, it } from "vitest";
import {
  buildArchitectureHealth,
  ratingBand,
  ratingForPath,
  ratingForQualityPath,
} from "./architectureHealth";
import type {
  FileQualityMetrics,
  PackageMetricRollup,
  PackageQualityMetrics,
  QualityIndex,
} from "./types";

function rollup(avg: number): PackageMetricRollup {
  return { avg, percentiles: { p50: avg, p80: avg, p90: avg } };
}

function file(
  path: string,
  overrides: Partial<FileQualityMetrics> = {},
): FileQualityMetrics {
  return {
    path,
    loc: 100,
    nloc: 80,
    cloc: 10,
    codeDensity: 80,
    commentDensity: 11,
    cyclomatic: 5,
    structural: 5,
    halsteadVolume: 100,
    halsteadDifficulty: 10,
    cognitive: 5,
    maintainability: 80,
    dit: 1,
    cbo: 2,
    coverage: 70,
    issueDensity: 1,
    securityDensity: 0,
    aiDensity: 0,
    duplicationHits: 0,
    duplicatedPct: 2,
    deadCodePct: 5,
    staleDecisionDensity: 0,
    ...overrides,
  };
}

function pkg(
  path: string,
  overrides: Partial<PackageQualityMetrics> & {
    complexityAvg?: number;
    maintainAvg?: number;
  } = {},
): PackageQualityMetrics {
  const {
    complexityAvg = 5,
    maintainAvg = 80,
    ...rest
  } = overrides;
  return {
    path,
    fileCount: 2,
    totalLoc: 200,
    totalNloc: 160,
    totalCloc: 20,
    complexity: rollup(complexityAvg),
    halstead: rollup(100),
    cognitive: rollup(5),
    maintainability: rollup(maintainAvg),
    cbo: rollup(2),
    coverage: rollup(70),
    issues: rollup(1),
    security: rollup(0),
    aiQuality: rollup(0),
    duplication: rollup(0),
    duplicatedCode: rollup(2),
    nloc: rollup(80),
    cloc: rollup(10),
    codeDensity: rollup(80),
    commentDensity: rollup(11),
    deadCode: rollup(5),
    staleDecisions: rollup(0),
    size: rollup(100),
    ...rest,
  };
}

describe("buildArchitectureHealth", () => {
  it("returns null without quality index", () => {
    expect(buildArchitectureHealth(null)).toBeNull();
    expect(buildArchitectureHealth(undefined)).toBeNull();
  });

  it("rates better packages higher than worse peers", () => {
    const quality: QualityIndex = {
      files: {
        "a/x.ts": file("a/x.ts", { cyclomatic: 2, maintainability: 90 }),
        "b/y.ts": file("b/y.ts", { cyclomatic: 40, maintainability: 20 }),
      },
      packages: {
        a: pkg("a", { complexityAvg: 2, maintainAvg: 90, totalLoc: 100 }),
        b: pkg("b", { complexityAvg: 40, maintainAvg: 20, totalLoc: 100 }),
      },
    };

    const report = buildArchitectureHealth(quality);
    expect(report).not.toBeNull();
    const a = report!.packages.find((p) => p.path === "a")!;
    const b = report!.packages.find((p) => p.path === "b")!;
    expect(a.rating).toBeGreaterThan(b.rating);
    expect(a.rating - b.rating).toBeGreaterThanOrEqual(5);
    expect(ratingForPath(report, "a")).toBe(a.rating);
    expect(ratingForQualityPath(quality, "a")).toBe(a.rating);
    expect(ratingForQualityPath(quality, "a/x.ts")).toBe(
      report!.files.find((f) => f.path === "a/x.ts")!.rating,
    );
    expect(ratingBand(a.rating)).toMatch(/healthy|fair|poor/);
  });

  it("gives equal peers the same high rating", () => {
    const quality: QualityIndex = {
      files: {
        "a.ts": file("a.ts"),
        "b.ts": file("b.ts"),
      },
      packages: {
        a: pkg("a"),
        b: pkg("b"),
      },
    };
    const report = buildArchitectureHealth(quality)!;
    expect(report.packages.every((p) => p.rating === 100)).toBe(true);
    expect(report.rating).toBeGreaterThanOrEqual(80);
  });

  it("changes overall rating when percentile view changes", () => {
    const quality: QualityIndex = {
      files: {
        "a.ts": file("a.ts", { cyclomatic: 2, loc: 20, maintainability: 90 }),
        "b.ts": file("b.ts", { cyclomatic: 8, loc: 40, maintainability: 75 }),
        "c.ts": file("c.ts", { cyclomatic: 40, loc: 400, maintainability: 30 }),
      },
      packages: {
        a: pkg("a", {
          complexityAvg: 2,
          maintainAvg: 90,
          complexity: {
            avg: 16,
            percentiles: { p50: 5, p80: 20, p90: 40 },
          },
          maintainability: {
            avg: 65,
            percentiles: { p50: 80, p80: 60, p90: 30 },
          },
        }),
      },
    };
    const atP50 = buildArchitectureHealth(quality, { percentileView: "p50" })!;
    const atP90 = buildArchitectureHealth(quality, { percentileView: "p90" })!;
    expect(atP50.rating).toBeGreaterThan(atP90.rating);
    expect(atP50.percentileView).toBe("p50");
    expect(atP90.percentileView).toBe("p90");
  });

  it("exposes project metric averages with percentiles", () => {
    const quality: QualityIndex = {
      files: {
        "a.ts": file("a.ts", { cyclomatic: 1, loc: 10, nloc: 8 }),
        "b.ts": file("b.ts", { cyclomatic: 10, loc: 100, nloc: 80 }),
        "c.ts": file("c.ts", { cyclomatic: 20, loc: 200, nloc: 160 }),
      },
      packages: {},
    };
    const report = buildArchitectureHealth(quality)!;
    const complexity = report.metrics.find((m) => m.id === "complexity");
    expect(complexity).toBeDefined();
    expect(complexity!.percentiles.p50).toBe(10);
    expect(complexity!.percentiles.p90).toBe(20);
    expect(report.metrics.find((m) => m.id === "nloc")).toBeDefined();
    expect(report.metrics.find((m) => m.id === "deadCode")).toBeDefined();
    expect(report.metrics.find((m) => m.id === "staleDecisions")).toBeDefined();
    expect(report.metrics.find((m) => m.id === "duplicatedCode")).toBeDefined();
    expect(report.fileCount).toBe(3);
  });

  it("blends DSM modularity into overall rating when provided", () => {
    const quality: QualityIndex = {
      files: { "a.ts": file("a.ts") },
      packages: { a: pkg("a") },
    };
    const plain = buildArchitectureHealth(quality)!;
    const blended = buildArchitectureHealth(quality, { modularityScore: 0 })!;
    expect(blended.rating).toBe(Math.round(plain.rating * 0.7));
    expect(blended.modularityScore).toBe(0);
  });

  it("returns null for an empty quality index", () => {
    expect(buildArchitectureHealth({ files: {}, packages: {} })).toBeNull();
  });

  it("rates files when packages are absent", () => {
    const quality: QualityIndex = {
      files: {
        "good.ts": file("good.ts", { cyclomatic: 1, maintainability: 95 }),
        "bad.ts": file("bad.ts", { cyclomatic: 50, maintainability: 10 }),
      },
      packages: {},
    };
    const report = buildArchitectureHealth(quality)!;
    expect(report.files).toHaveLength(2);
    expect(report.files[0]!.rating).toBeGreaterThan(report.files[1]!.rating);
    expect(ratingForPath(report, "missing")).toBeNull();
    expect(ratingForPath(null, "good.ts")).toBeNull();
  });

  it("rates packages using selected percentile rollups", () => {
    const quality: QualityIndex = {
      files: { "a.ts": file("a.ts"), "b.ts": file("b.ts") },
      packages: {
        good: pkg("good", {
          complexity: { avg: 20, percentiles: { p50: 2, p80: 10, p90: 40 } },
          maintainability: {
            avg: 50,
            percentiles: { p50: 90, p80: 60, p90: 20 },
          },
        }),
        bad: pkg("bad", {
          complexity: { avg: 20, percentiles: { p50: 30, p80: 35, p90: 40 } },
          maintainability: {
            avg: 50,
            percentiles: { p50: 25, p80: 20, p90: 15 },
          },
        }),
      },
    };
    const atP50 = buildArchitectureHealth(quality, { percentileView: "p50" })!;
    const good = atP50.packages.find((p) => p.path === "good")!;
    const bad = atP50.packages.find((p) => p.path === "bad")!;
    expect(good.rating).toBeGreaterThan(bad.rating);
    expect(ratingBand(95)).toBe("healthy");
    expect(ratingBand(60)).toBe("fair");
    expect(ratingBand(20)).toBe("poor");
  });

  it("labels root package and nested file names", () => {
    const quality: QualityIndex = {
      files: { "src/util/x.ts": file("src/util/x.ts") },
      packages: { ".": pkg(".") },
    };
    const report = buildArchitectureHealth(quality)!;
    expect(report.packages[0]!.label).toBe("(root)");
    expect(report.files[0]!.label).toBe("x.ts");
  });

  it("lowers overall rating when dead/stale/duplicated metrics worsen", () => {
    const healthy = buildArchitectureHealth({
      files: {
        "a.ts": file("a.ts", {
          duplicatedPct: 0,
          deadCodePct: 0,
          staleDecisionDensity: 0,
          commentDensity: 20,
          codeDensity: 80,
        }),
      },
      packages: {},
    })!;
    const dirty = buildArchitectureHealth({
      files: {
        "a.ts": file("a.ts", {
          duplicatedPct: 60,
          deadCodePct: 80,
          staleDecisionDensity: 40,
          commentDensity: 0,
          codeDensity: 20,
        }),
      },
      packages: {},
    })!;
    expect(healthy.rating).toBeGreaterThan(dirty.rating);
  });
});
