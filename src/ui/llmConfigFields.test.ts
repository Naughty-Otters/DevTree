import { describe, expect, it } from "vitest";
import { createLlmConfigFields } from "./llmConfigFields";

describe("ui/llmConfigFields", () => {
  it("exports createLlmConfigFields", () => {
    expect(typeof createLlmConfigFields).toBe("function");
  });
});
