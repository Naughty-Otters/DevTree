import { describe, expect, it } from "vitest";
import { HIERARCHY_VERSION } from "./types";
import type { AnalysisResult } from "./types";
import {
  analysisStatusTone,
  formatAnalysisStatusSummary,
} from "./statusSummary";

function baseResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    graph: { nodes: [], edges: [] },
    hierarchy: {
      version: HIERARCHY_VERSION,
      files: [],
      packages: [],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    },
    validation: [],
    suggestions: [],
    summary: "",
    dsm: {
      level: "package",
      scope: null,
      ordering: "partitioned",
      elements: [],
      matrix: [],
      cycleNodes: [],
      metrics: {
        cycleCount: 0,
        nodesInCycles: 0,
        upperTriangleDensity: 0,
        couplingDensity: 0,
        propagationCost: 0,
        clusteredCost: 0,
        clusteredCostNormalized: 0,
        busCount: 0,
        healthScore: 97,
      },
      violations: [],
      capped: false,
    },
    quality: {
      files: {},
      packages: {
        a: {
          path: "a",
          fileCount: 100,
          totalLoc: 1000,
          complexity: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          halstead: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          cognitive: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          maintainability: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          cbo: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          coverage: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          issues: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          security: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          aiQuality: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          duplication: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          size: { avg: 10, percentiles: { p50: 10, p80: 10, p90: 10 } },
        },
        b: {
          path: "b",
          fileCount: 78,
          totalLoc: 800,
          complexity: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          halstead: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          cognitive: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          maintainability: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          cbo: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          coverage: { avg: 1, percentiles: { p50: 1, p80: 1, p90: 1 } },
          issues: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          security: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          aiQuality: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          duplication: { avg: 0, percentiles: { p50: 0, p80: 0, p90: 0 } },
          size: { avg: 10, percentiles: { p50: 10, p80: 10, p90: 10 } },
        },
      },
    },
    ...overrides,
  };
}

describe("analysis/statusSummary", () => {
  it("prefers the backend summary when present", () => {
    const summary =
      "Analyzed 178 packages (24425 source files) with 17 rule(s): 0 passed, 14 warnings, 3 failures · modularity health 97";
    expect(
      formatAnalysisStatusSummary(baseResult({ summary })),
    ).toBe(summary);
  });

  it("rebuilds the status line from slim package quality when summary is empty", () => {
    const text = formatAnalysisStatusSummary(
      baseResult({
        summary: "",
        validation: [
          {
            rule_id: "a",
            rule_name: "A",
            status: "pass",
            message: "ok",
            affected: [],
          },
          {
            rule_id: "b",
            rule_name: "B",
            status: "warn",
            message: "w",
            affected: [],
          },
          {
            rule_id: "c",
            rule_name: "C",
            status: "fail",
            message: "f",
            affected: [],
          },
        ],
      }),
    );
    expect(text).toBe(
      "Analyzed 2 packages (178 source files) with 3 rule(s): 1 passed, 1 warnings, 1 failures · modularity health 97",
    );
  });

  it("tones by failures then warnings", () => {
    expect(
      analysisStatusTone(
        baseResult({
          validation: [
            {
              rule_id: "a",
              rule_name: "A",
              status: "fail",
              message: "f",
              affected: [],
            },
          ],
        }),
      ),
    ).toBe("fail");
    expect(
      analysisStatusTone(
        baseResult({
          validation: [
            {
              rule_id: "a",
              rule_name: "A",
              status: "warn",
              message: "w",
              affected: [],
            },
          ],
        }),
      ),
    ).toBe("warn");
    expect(analysisStatusTone(baseResult())).toBe("ok");
  });
});
