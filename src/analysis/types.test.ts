import { describe, expect, it } from "vitest";
import { defaultRuleSettings, HIERARCHY_VERSION, mergeRuleSettings, type AnalysisRule } from "./types";

const RULES: AnalysisRule[] = [
  { id: "r1", name: "Rule 1", description: "", category: "test", settings: [{ key: "n", label: "N", kind: "number", default: 1 }] },
];

describe("analysis/types", () => {
  it("builds default rule settings from rule defs", () => {
    expect(defaultRuleSettings(RULES).r1.n).toBe(1);
    expect(HIERARCHY_VERSION).toBeGreaterThan(0);
  });

  it("merges persisted settings over defaults", () => {
    const merged = mergeRuleSettings(RULES, { r1: { n: 5 } });
    expect(merged.r1.n).toBe(5);
  });
});
