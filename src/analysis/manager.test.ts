import { describe, expect, it } from "vitest";
import { createAnalysisManager } from "./manager";

describe("analysis/manager", () => {
  it("exports analysis manager factory", () => {
    expect(typeof createAnalysisManager).toBe("function");
  });
});
