import { describe, expect, it } from "vitest";
import { createLlmConfigurationPicker } from "./llmConfigurationPicker";

describe("llmConfigurationPicker", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() =>
      createLlmConfigurationPicker(container, {
        configurations: [],
        providers: [],
        value: "",
        onChange: () => {},
      }),
    ).not.toThrow();
    expect(container).toBeDefined();
  });
});
