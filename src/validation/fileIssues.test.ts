import { describe, expect, it } from "vitest";
import { collectFileIssues, issuesByLine } from "./fileIssues";
import type { AnalysisResult } from "../analysis/types";
import { minimalHierarchy } from "../test/fixtures/hierarchy";

const baseResult = (): AnalysisResult => ({
  graph: { nodes: [], edges: [] },
  hierarchy: minimalHierarchy(),
  validation: [],
  suggestions: [],
  summary: "",
});

describe("validation/fileIssues", () => {
  it("collects issues for a matching file path", () => {
    const result: AnalysisResult = {
      ...baseResult(),
      validation: [{
        rule_id: "lint",
        rule_name: "Lint",
        status: "fail",
        message: "issue",
        affected: ["src/a.ts:3 — [error] bad"],
      }],
    };
    const issues = collectFileIssues(result, "src/a.ts");
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
    expect(issues[0].severity).toBe("error");
  });

  it("maps warn status to warning severity", () => {
    const result: AnalysisResult = {
      ...baseResult(),
      validation: [{
        rule_id: "lint",
        rule_name: "Lint",
        status: "warn",
        message: "caution",
        affected: ["src/a.ts — caution"],
      }],
    };
    expect(collectFileIssues(result, "src/a.ts")[0].severity).toBe("warning");
  });

  it("returns empty list for null result", () => {
    expect(collectFileIssues(null, "src/a.ts")).toEqual([]);
  });

  it("groups issues by line number", () => {
    const issues = collectFileIssues({
      ...baseResult(),
      validation: [{
        rule_id: "lint",
        rule_name: "Lint",
        status: "fail",
        message: "x",
        affected: ["src/a.ts:2 — [error] a", "src/a.ts:2 — [error] b"],
      }],
    }, "src/a.ts");
    const byLine = issuesByLine(issues);
    expect(byLine.get(2)?.length).toBe(2);
  });
});
