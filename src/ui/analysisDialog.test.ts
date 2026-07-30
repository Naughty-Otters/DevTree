import { describe, expect, it } from "vitest";
import { showAnalysisDialog } from "./analysisDialog";

describe("analysisDialog", () => {
  it("creates or renders without throwing", () => {
    expect(() => {
      void showAnalysisDialog(1);
    }).not.toThrow();
  });
});
