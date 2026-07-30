import { describe, expect, it } from "vitest";
import {
  normalizeStage,
  pipelineStageFillPercent,
  pipelineStageStatus,
} from "./progressDisplay";

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
    expect(pipelineStageFillPercent("scanning", "scanning", null)).toBeGreaterThan(
      0,
    );
  });
});
