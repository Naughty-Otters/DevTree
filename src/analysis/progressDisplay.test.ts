import { describe, expect, it } from "vitest";
import {
  countActiveTasks,
  effectiveRuleStatus,
  getPipelineStages,
  normalizeStage,
  overallProgressMeta,
  overallProgressPercent,
  pipelineStageFillPercent,
  pipelineStageStatus,
  ruleTaskFillPercent,
} from "./progressDisplay";
import type { AnalysisProgress } from "./types";

describe("progressDisplay", () => {
  it("normalizes starting stage to scanning", () => {
    expect(normalizeStage("starting")).toBe("scanning");
    expect(normalizeStage("validating")).toBe("validating");
  });

  it("marks earlier pipeline stages done while validating", () => {
    expect(pipelineStageStatus("validating", "scanning")).toBe("done");
    expect(pipelineStageStatus("validating", "validating")).toBe("running");
    expect(pipelineStageStatus("validating", "done")).toBe("pending");
  });

  it("fills completed stages to 100%", () => {
    expect(pipelineStageFillPercent("validating", "scanning", null)).toBe(100);
    expect(pipelineStageFillPercent("scanning", "scanning", null)).toBeGreaterThan(0);
  });

  it("keeps pipeline stages progressing during quality precompute", () => {
    expect(pipelineStageStatus("quality", "validating")).toBe("done");
    expect(pipelineStageStatus("quality", "quality")).toBe("running");
    expect(pipelineStageStatus("quality", "scanning")).toBe("done");
    expect(normalizeStage("metrics")).toBe("quality");
  });

  it("counts active pipeline and rule tasks", () => {
    expect(getPipelineStages().length).toBe(6);
    expect(
      countActiveTasks("scanning", [
        { ruleId: "r", ruleName: "Rule", status: "running" },
      ]),
    ).toBeGreaterThan(0);
    expect(
      effectiveRuleStatus({ ruleId: "r", ruleName: "Rule", status: "pending" }),
    ).toBe("pending");
  });

  it("computes rule and overall progress metadata", () => {
    const progress: AnalysisProgress = {
      analysisId: "a1",
      stage: "validating",
      message: "Validating…",
      percent: 42,
      current: 2,
      total: 5,
      ruleTasks: [],
    };
    expect(overallProgressPercent(progress)).toBe(42);
    expect(overallProgressMeta(progress)).toContain("2/5");
    expect(
      ruleTaskFillPercent(
        { ruleId: "r", ruleName: "Rule", status: "running" },
        progress,
      ),
    ).toBeGreaterThan(0);
    expect(
      ruleTaskFillPercent(
        { ruleId: "r", ruleName: "Rule", status: "done" },
        progress,
      ),
    ).toBe(100);
  });
});
