import type { LocPercentiles } from "./moduleStats";

/** How percentile distributions are emphasized in quality UIs. */
export type PercentileViewMode = "avg" | "p50" | "p80" | "p90" | "all";

export const PERCENTILE_VIEW_MODES: PercentileViewMode[] = [
  "avg",
  "p50",
  "p80",
  "p90",
  "all",
];

export function parsePercentileViewMode(
  value: unknown,
): PercentileViewMode {
  if (
    value === "avg" ||
    value === "p50" ||
    value === "p80" ||
    value === "p90" ||
    value === "all"
  ) {
    return value;
  }
  return "all";
}

export function percentileViewLabel(mode: PercentileViewMode): string {
  switch (mode) {
    case "avg":
      return "Avg";
    case "p50":
      return "p50";
    case "p80":
      return "p80";
    case "p90":
      return "p90";
    case "all":
      return "All";
  }
}

function formatNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function percentileValue(
  percentiles: LocPercentiles,
  mode: Exclude<PercentileViewMode, "avg" | "all">,
): number {
  return percentiles[mode];
}

/** Primary display for a metric under the active percentile view. */
export function formatMetricPrimary(
  avg: number,
  percentiles: LocPercentiles | null | undefined,
  mode: PercentileViewMode,
  digits = 0,
  asPercent = false,
): string {
  const suffix = asPercent ? "%" : "";
  if (!percentiles || mode === "avg") {
    return `${formatNum(avg, digits)}${suffix}`;
  }
  if (mode === "all") {
    return `${formatNum(percentiles.p50, digits)} / ${formatNum(percentiles.p80, digits)} / ${formatNum(percentiles.p90, digits)}${suffix}`;
  }
  return `${formatNum(percentileValue(percentiles, mode), digits)}${suffix}`;
}

/** Secondary hint under the primary value. */
export function formatMetricHint(
  avg: number,
  percentiles: LocPercentiles | null | undefined,
  mode: PercentileViewMode,
  digits = 0,
): string | null {
  if (!percentiles) return null;
  if (mode === "all") {
    return `avg ${formatNum(avg, digits)}`;
  }
  if (mode === "avg") {
    return `p50 · p80 · p90  ${formatNum(percentiles.p50, digits)} / ${formatNum(percentiles.p80, digits)} / ${formatNum(percentiles.p90, digits)}`;
  }
  const others = PERCENTILE_VIEW_MODES.filter(
    (m): m is "p50" | "p80" | "p90" =>
      m !== mode && m !== "avg" && m !== "all",
  )
    .map((m) => `${m} ${formatNum(percentiles[m], digits)}`)
    .join(" · ");
  return `avg ${formatNum(avg, digits)} · ${others}`;
}

export function formatPercentilesView(
  percentiles: LocPercentiles,
  mode: PercentileViewMode,
  digits = 0,
): string {
  if (mode === "all" || mode === "avg") {
    return `p50 · p80 · p90  ${formatNum(percentiles.p50, digits)} / ${formatNum(percentiles.p80, digits)} / ${formatNum(percentiles.p90, digits)}`;
  }
  return `${mode}  ${formatNum(percentileValue(percentiles, mode), digits)}`;
}
