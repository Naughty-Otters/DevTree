import { describe, expect, it } from "vitest";
import { createRulesPanel } from "./rulesPanel";

describe("rulesPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createRulesPanel(container, { rules: [], selected: new Set(), settings: {}, expandedRuleId: null, loading: true }, () => {})).not.toThrow();
    expect(container).toBeDefined();
  });

  it("shows a loading placeholder while rules load", () => {
    const container = document.createElement("div");
    createRulesPanel(
      container,
      {
        rules: [],
        selected: new Set(),
        settings: {},
        expandedRuleId: null,
        loading: true,
      },
      () => {},
    );
    expect(container.querySelector(".loading-placeholder")).toBeTruthy();
    expect(container.textContent).toContain("Loading analysis rules");
  });
});
