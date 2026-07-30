import { describe, expect, it } from "vitest";
import { createLlmRuntimeSettingsPanel } from "./llmRuntimeSettingsPanel";

describe("llmRuntimeSettingsPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createLlmRuntimeSettingsPanel(container, { maxTurns: 128, agentMaxTurns: 64 }, { onChange: () => {} })).not.toThrow();
    expect(container).toBeDefined();
  });
});
