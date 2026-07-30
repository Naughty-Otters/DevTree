import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "./options";

describe("analysis/options", () => {
  it("defaults to file module granularity", () => {
    expect(DEFAULT_ANALYSIS_OPTIONS.moduleGranularity).toBe("file");
  });
});
