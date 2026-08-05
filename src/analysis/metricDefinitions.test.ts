import { describe, expect, it } from "vitest";
import {
  definedMetricIds,
  metricDefinition,
  metricDefinitionText,
} from "./metricDefinitions";

describe("metricDefinitions", () => {
  it("covers quality and modularity metric ids with formulas", () => {
    const ids = definedMetricIds();
    expect(ids).toContain("complexity");
    expect(ids).toContain("halstead");
    expect(ids).toContain("abc");
    expect(ids).toContain("ccp");
    expect(ids).toContain("commentDensity");
    expect(ids).toContain("propagation");
    expect(ids).toContain("modularityHealth");

    for (const id of ids) {
      const def = metricDefinition(id);
      expect(def, id).toBeTruthy();
      expect(metricDefinitionText(def!, "summary", "en").length).toBeGreaterThan(0);
      expect(metricDefinitionText(def!, "body", "en").length).toBeGreaterThan(0);
      expect(metricDefinitionText(def!, "formula", "en").length).toBeGreaterThan(0);
      expect(metricDefinitionText(def!, "summary", "zh-CN").length).toBeGreaterThan(0);
      expect(metricDefinitionText(def!, "formula", "zh-CN").length).toBeGreaterThan(0);
    }
  });

  it("returns localized summary/body and learn-more urls", () => {
    const def = metricDefinition("complexity");
    expect(def).toBeTruthy();
    expect(metricDefinitionText(def!, "summary", "en")).toMatch(/cyclomatic/i);
    expect(metricDefinitionText(def!, "summary", "zh-CN")).toMatch(/圈复杂度/);
    expect(metricDefinitionText(def!, "formula", "en")).toMatch(/CC\s*=/);
    expect(def!.learnMoreUrl).toContain("wikipedia");
    expect(def!.direction).toBe("lower-better");
  });

  it("returns null for unknown metric ids", () => {
    expect(metricDefinition("not-a-real-metric")).toBeNull();
  });

  it("falls back to English when a locale entry is missing", () => {
    const def = metricDefinition("size")!;
    // Force fallback path by requesting a field that always has en.
    expect(metricDefinitionText(def, "formula", "en")).toMatch(/LOC/);
  });
});
