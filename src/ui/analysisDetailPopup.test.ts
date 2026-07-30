import { describe, expect, it } from "vitest";
import { showAnalysisStatDetail } from "./analysisDetailPopup";

describe("ui/analysisDetailPopup", () => {
  it("exports showAnalysisStatDetail", () => {
    expect(typeof showAnalysisStatDetail).toBe("function");
  });
});
