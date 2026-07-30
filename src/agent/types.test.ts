import { describe, expect, it } from "vitest";
import { DEFAULT_LLM_PROVIDER } from "./types";

describe("agent/types", () => {
  it("defines a default LLM provider", () => {
    expect(DEFAULT_LLM_PROVIDER).toBe("openai");
  });
});
