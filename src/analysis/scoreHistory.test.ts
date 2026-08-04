import { describe, expect, it } from "vitest";
import {
  appendScorePoint,
  computeScoreSnapshot,
  MAX_SCORE_HISTORY,
  parseScoreHistory,
} from "./scoreHistory";
import type {
  PackageMetricRollup,
  PackageQualityMetrics,
  QualityIndex,
  AnalysisResult,
} from "./types";
import type { DsmResult } from "./dsm";

function rollup(avg: number): PackageMetricRollup {
  return { avg, percentiles: { p50: avg, p80: avg, p90: avg } };
}

function pkg(path: string): PackageQualityMetrics {
  return {
    path,
    fileCount: 2,
    totalLoc: 200,
    totalNloc: 160,
    totalCloc: 20,
    complexity: rollup(5),
    halstead: rollup(100),
    cognitive: rollup(5),
    maintainability: rollup(80),
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
  };
}

function result(opts?: {
  modularity?: number;
  quality?: QualityIndex | null;
}): AnalysisResult {
  const quality: QualityIndex | null =
    opts?.quality === undefined
      ? {
          files: {},
          packages: { ".": pkg(".") },
        }
      : opts.quality;

  const dsm: DsmResult | null =
    opts?.modularity == null
      ? null
      : ({
          level: "package",
          elements: [{ id: "a", label: "a" }],
          matrix: [[0]],
          metrics: {
            cycleCount: 2,
            nodesInCycles: 3,
            upperTriangleDensity: 0.12,
            couplingDensity: 0.2,
            propagationCost: 0.3,
            clusteredCost: 10,
            clusteredCostNormalized: 0.25,
            busCount: 1,
            healthScore: opts.modularity,
          },
          cycleNodes: [],
          violations: [],
          capped: false,
          ordering: "partitioned",
        } as DsmResult);

  return {
    graph: {
      nodes: [
        { id: "a", label: "a", path: "a", loc: 1, kind: "package" },
        { id: "b", label: "b", path: "b", loc: 1, kind: "package" },
      ],
      edges: [],
    },
    hierarchy: {
      files: [],
      packages: ["a", "b"],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    },
    validation: [
      {
        rule_id: "r1",
        rule_name: "R1",
        status: "pass",
        message: "ok",
        affected: [],
      },
      {
        rule_id: "r2",
        rule_name: "R2",
        status: "warn",
        message: "warn",
        affected: [],
      },
      {
        rule_id: "r3",
        rule_name: "R3",
        status: "fail",
        message: "fail",
        affected: [],
      },
    ],
    suggestions: [],
    summary: "ok",
    quality,
    dsm,
  };
}

describe("scoreHistory", () => {
  it("returns null without quality metrics", () => {
    expect(computeScoreSnapshot(result({ quality: null }))).toBeNull();
    expect(
      computeScoreSnapshot(result({ quality: { files: {}, packages: {} } })),
    ).toBeNull();
  });

  it("computes overall, architecture, modularity, and sub-metrics", () => {
    const snap = computeScoreSnapshot(
      result({ modularity: 40 }),
      "all",
      1_700_000_000_000,
    );
    expect(snap).not.toBeNull();
    expect(snap!.at).toBe(1_700_000_000_000);
    expect(snap!.modularity).toBe(40);
    expect(snap!.architecture).toBeGreaterThanOrEqual(0);
    expect(snap!.overall).not.toBe(snap!.architecture);
    expect(snap!.overallStats).toEqual({
      packages: 2,
      files: 2,
      rules: 3,
      passed: 1,
      warnings: 1,
      failures: 1,
    });
    expect(snap!.architectureMetrics?.complexity).toBeGreaterThanOrEqual(0);
    expect(snap!.modularityMetrics).toMatchObject({
      cycles: 2,
      nodesInCycles: 3,
      upperTrianglePct: 12,
      buses: 1,
    });
  });

  it("defaults modularity to 100 when DSM is missing", () => {
    const snap = computeScoreSnapshot(result());
    expect(snap!.modularity).toBe(100);
    expect(snap!.modularityMetrics).toBeUndefined();
  });

  it("appends and caps history at MAX_SCORE_HISTORY", () => {
    const base = Array.from({ length: MAX_SCORE_HISTORY }, (_, i) => ({
      at: i,
      overall: 50,
      architecture: 50,
      modularity: 50,
      percentileView: "all",
    }));
    const next = {
      at: MAX_SCORE_HISTORY,
      overall: 90,
      architecture: 80,
      modularity: 70,
      percentileView: "all",
    };
    const out = appendScorePoint(base, next);
    expect(out).toHaveLength(MAX_SCORE_HISTORY);
    expect(out[0]!.at).toBe(1);
    expect(out[out.length - 1]).toEqual(next);
  });

  it("parses v1 and v2 persisted history payloads", () => {
    const v1 = parseScoreHistory({
      version: 1,
      projectRoot: "/tmp/proj",
      points: [
        {
          at: 10,
          overall: 70.4,
          architecture: 80.2,
          modularity: 60.9,
          percentileView: "p80",
        },
      ],
    });
    expect(v1?.points[0]).toMatchObject({
      at: 10,
      overall: 70,
      architecture: 80,
      modularity: 61,
    });

    const v2 = parseScoreHistory({
      version: 2,
      projectRoot: "/tmp/proj",
      points: [
        {
          at: 10,
          overall: 70,
          architecture: 80,
          modularity: 60,
          percentileView: "all",
          overallStats: {
            packages: 3,
            files: 10,
            rules: 2,
            passed: 1,
            warnings: 1,
            failures: 0,
          },
          architectureMetrics: { complexity: 90 },
          modularityMetrics: {
            cycles: 1,
            nodesInCycles: 2,
            upperTrianglePct: 5,
            couplingPct: 10,
            propagationPct: 15,
            clusteredCostPct: 20,
            buses: 0,
          },
        },
      ],
    });
    expect(v2?.version).toBe(2);
    expect(v2?.points[0]?.overallStats?.packages).toBe(3);
    expect(v2?.points[0]?.architectureMetrics?.complexity).toBe(90);
    expect(v2?.points[0]?.modularityMetrics?.cycles).toBe(1);
  });
});
