import { describe, expect, it } from "vitest";
import type { AnalysisResult, HierarchyIndex } from "./types";
import {
  buildIssueIndex,
  computeQualityReport,
  keywordComplexity,
  structuralComplexity,
} from "./codeQualityMetrics";

function hierarchy(): HierarchyIndex {
  return {
    files: [
      { path: "pkg/a.ts", label: "a.ts", loc: 40, package: "pkg" },
      { path: "pkg/b.ts", label: "b.ts", loc: 80, package: "pkg" },
      { path: "pkg/a.test.ts", label: "a.test.ts", loc: 20, package: "pkg" },
    ],
    packages: ["pkg"],
    file_imports: {
      "pkg/a.ts": ["pkg/b.ts"],
      "pkg/b.ts": [],
    },
    package_edges: [],
    symbols: {
      "pkg/a.ts": [
        { id: "pkg/a.ts#foo", label: "foo", kind: "function", file: "pkg/a.ts", line: 1 },
        { id: "pkg/a.ts#bar", label: "bar", kind: "function", file: "pkg/a.ts", line: 2 },
      ],
      "pkg/b.ts": [
        { id: "pkg/b.ts#baz", label: "baz", kind: "function", file: "pkg/b.ts", line: 1 },
      ],
    },
    symbol_edges: [
      { source: "pkg/a.ts#foo", target: "pkg/a.ts#bar", kind: "call" },
    ],
  };
}

describe("keywordComplexity", () => {
  it("counts decision points", () => {
    const src = `
      function f(a, b) {
        if (a && b) return 1;
        for (const x of b) {
          while (x) break;
        }
        return a || b ? 1 : 0;
      }
    `;
    expect(keywordComplexity(src)).toBeGreaterThan(5);
  });
});

describe("structuralComplexity", () => {
  it("uses symbols, calls, and imports", () => {
    const h = hierarchy();
    // 1 + 2 symbols + 1 internal call + 1 import
    expect(structuralComplexity(h, "pkg/a.ts")).toBe(5);
  });
});

describe("computeQualityReport", () => {
  it("returns Codacy-style metrics for a file", () => {
    const analysis: AnalysisResult = {
      graph: { nodes: [], edges: [] },
      hierarchy: hierarchy(),
      validation: [
        {
          rule_id: "language_linters",
          rule_name: "Linters",
          status: "warn",
          message: "style",
          affected: ["pkg/b.ts:1 — [warning] unused"],
        },
        {
          rule_id: "review_security",
          rule_name: "Security",
          status: "fail",
          message: "issue",
          affected: ["pkg/b.ts — secret"],
        },
      ],
      suggestions: [],
      summary: "",
    };

    const report = computeQualityReport(
      hierarchy(),
      { kind: "file", path: "pkg/b.ts" },
      analysis,
    );
    expect(report?.kind).toBe("file");
    const ids = report?.metrics.map((m) => m.id);
    expect(ids).toEqual([
      "complexity",
      "halstead",
      "cognitive",
      "maintainability",
      "dit",
      "cbo",
      "churn",
      "coverage",
      "security",
      "documentation",
      "duplication",
      "issues",
      "aiQuality",
      "size",
    ]);
    expect(report?.metrics.find((m) => m.id === "coverage")?.value).toBe(0);
    expect(report?.metrics.find((m) => m.id === "security")?.value).toBeGreaterThan(0);
    expect(report?.metrics.find((m) => m.id === "size")?.value).toBe(80);
    expect(report?.metrics.find((m) => m.id === "cbo")?.value).toBe(0);
    expect(report?.metrics.find((m) => m.id === "halstead")?.value).toBeGreaterThan(0);
  });

  it("returns package averages with percentiles including classic metrics", () => {
    const report = computeQualityReport(
      hierarchy(),
      { kind: "package", path: "pkg" },
      null,
    );
    expect(report?.kind).toBe("package");
    expect(report?.fileCount).toBe(3);
    const complexity = report?.metrics.find((m) => m.id === "complexity");
    expect(complexity?.percentiles).toBeTruthy();
    expect(complexity?.detail).toMatch(/p50\/p80\/p90/);
    const coverage = report?.metrics.find((m) => m.id === "coverage");
    expect(coverage?.value).toBeGreaterThan(0);
    expect(report?.metrics.find((m) => m.id === "cbo")?.percentiles).toBeTruthy();
    expect(report?.metrics.find((m) => m.id === "halstead")?.percentiles).toBeTruthy();
    expect(report?.metrics.find((m) => m.id === "maintainability")?.percentiles).toBeTruthy();
  });

  it("indexes validation issues by file", () => {
    const map = buildIssueIndex({
      graph: { nodes: [], edges: [] },
      hierarchy: hierarchy(),
      validation: [
        {
          rule_id: "ai_clean_code",
          rule_name: "Clean",
          status: "warn",
          message: "x",
          affected: ["pkg/a.ts — smell"],
        },
      ],
      suggestions: [],
      summary: "",
    });
    expect(map.get("pkg/a.ts")?.ai).toBeGreaterThan(0);
  });
});
