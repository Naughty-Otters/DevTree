import { describe, expect, it } from "vitest";
import { createResultsPanel } from "./resultsPanel";

describe("resultsPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createResultsPanel(container)).not.toThrow();
    expect(container).toBeDefined();
  });
});
