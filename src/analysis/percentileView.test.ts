import { describe, expect, it } from "vitest";
import {
  formatMetricHint,
  formatMetricPrimary,
  formatPercentilesView,
  parsePercentileViewMode,
  percentileValue,
  percentileViewLabel,
  PERCENTILE_VIEW_MODES,
} from "./percentileView";

const sample = { p50: 10, p80: 20, p90: 30 };

describe("percentileView", () => {
  it("lists all supported modes", () => {
    expect(PERCENTILE_VIEW_MODES).toEqual(["avg", "p50", "p80", "p90", "all"]);
  });

  it("parses known modes and defaults unknown to all", () => {
    expect(parsePercentileViewMode("avg")).toBe("avg");
    expect(parsePercentileViewMode("p50")).toBe("p50");
    expect(parsePercentileViewMode("p80")).toBe("p80");
    expect(parsePercentileViewMode("p90")).toBe("p90");
    expect(parsePercentileViewMode("all")).toBe("all");
    expect(parsePercentileViewMode("nope")).toBe("all");
    expect(parsePercentileViewMode(null)).toBe("all");
    expect(parsePercentileViewMode(undefined)).toBe("all");
  });

  it("labels modes for the switcher UI", () => {
    expect(percentileViewLabel("avg")).toBe("Avg");
    expect(percentileViewLabel("p50")).toBe("p50");
    expect(percentileViewLabel("p80")).toBe("p80");
    expect(percentileViewLabel("p90")).toBe("p90");
    expect(percentileViewLabel("all")).toBe("All");
  });

  it("reads a single percentile value", () => {
    expect(percentileValue(sample, "p50")).toBe(10);
    expect(percentileValue(sample, "p80")).toBe(20);
    expect(percentileValue(sample, "p90")).toBe(30);
  });

  it("formats primary value per mode", () => {
    expect(formatMetricPrimary(15, sample, "avg")).toBe("15");
    expect(formatMetricPrimary(15, sample, "p50")).toBe("10");
    expect(formatMetricPrimary(15, sample, "p80")).toBe("20");
    expect(formatMetricPrimary(15, sample, "p90")).toBe("30");
    expect(formatMetricPrimary(15, sample, "all")).toBe("10 / 20 / 30");
    expect(formatMetricPrimary(70, sample, "p50", 0, true)).toBe("10%");
    expect(formatMetricPrimary(15, null, "p90")).toBe("15");
    expect(formatMetricPrimary(1.25, sample, "avg", 1)).toBe("1.3");
  });

  it("formats secondary hints", () => {
    expect(formatMetricHint(15, sample, "avg")).toContain("p50");
    expect(formatMetricHint(15, sample, "all")).toBe("avg 15");
    expect(formatMetricHint(15, sample, "p50")).toContain("avg 15");
    expect(formatMetricHint(15, sample, "p50")).toContain("p80");
    expect(formatMetricHint(15, null, "p50")).toBeNull();
  });

  it("formats classic percentile line", () => {
    expect(formatPercentilesView(sample, "avg")).toMatch(/p50 · p80 · p90/);
    expect(formatPercentilesView(sample, "all")).toMatch(/p50 · p80 · p90/);
    expect(formatPercentilesView(sample, "p90")).toBe("p90  30");
  });
});
