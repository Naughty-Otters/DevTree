import { describe, expect, it } from "vitest";
import { effectiveLlmModel, formatModelLabel, mockLlmProviders } from "./llmCatalog";

describe("validation/llmCatalog", () => {
  it("trims effective model names", () => {
    expect(effectiveLlmModel("  gpt-4o-mini  ")).toBe("gpt-4o-mini");
  });

  it("formats model labels for display", () => {
    expect(formatModelLabel("gpt-4o-mini")).toBe("Gpt 4o Mini");
  });

  it("lists mock LLM providers", () => {
    const providers = mockLlmProviders();
    expect(providers.some((p) => p.id === "openai")).toBe(true);
  });
});
