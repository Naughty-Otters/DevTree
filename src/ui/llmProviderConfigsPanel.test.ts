import { describe, expect, it } from "vitest";
import { createLlmProviderConfigsPanel } from "./llmProviderConfigsPanel";

describe("llmProviderConfigsPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createLlmProviderConfigsPanel(container, { providers: [], configs: {}, onChange: () => {} })).not.toThrow();
    expect(container).toBeDefined();
  });
});
