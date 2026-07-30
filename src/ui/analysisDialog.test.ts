import { describe, expect, it } from "vitest";
import { showAnalysisDialog } from "./analysisDialog";

describe("analysisDialog", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => showAnalysisDialog(container, { title: "t", message: "m" }, () => {})).not.toThrow();
    expect(container).toBeDefined();
  });
});
