import { describe, expect, it } from "vitest";
import { createRulesPanel } from "./rulesPanel";

describe("rulesPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createRulesPanel(container, { rules: [], selected: new Set(), settings: {}, expandedRuleId: null, loading: true }, () => {})).not.toThrow();
    expect(container).toBeDefined();
  });
});
