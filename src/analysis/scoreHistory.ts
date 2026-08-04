import {
  architectureMetricScores,
  buildArchitectureHealth,
} from "./architectureHealth";
import type { PercentileViewMode } from "./percentileView";
import { parsePercentileViewMode } from "./percentileView";
import { analysisStatusCounts } from "./statusSummary";
import type { AnalysisResult } from "./types";

/** Max snapshots kept per project (oldest trimmed). */
export const MAX_SCORE_HISTORY = 60;

export interface OverallStatsSnapshot {
  packages: number;
  files: number;
  rules: number;
  passed: number;
  warnings: number;
  failures: number;
}

export interface ModularityMetricsSnapshot {
  cycles: number;
  nodesInCycles: number;
  /** 0–100 percent */
  upperTrianglePct: number;
  /** 0–100 percent */
  couplingPct: number;
  /** 0–100 percent */
  propagationPct: number;
  /** 0–100 percent */
  clusteredCostPct: number;
  buses: number;
}

export interface AnalysisScoreSnapshot {
  at: number;
  overall: number;
  architecture: number;
  modularity: number;
  percentileView: string;
  /** Report status-card counts (Overall section). */
  overallStats?: OverallStatsSnapshot;
  /** Architecture quality metric scores 0–100 by id. */
  architectureMetrics?: Record<string, number>;
  /** DSM modularity sub-metrics. */
  modularityMetrics?: ModularityMetricsSnapshot;
}

export interface AnalysisScoreHistory {
  version: 1 | 2;
  projectRoot: string;
  points: AnalysisScoreSnapshot[];
}

function pct01(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10;
}

/**
 * Build a score snapshot from an analysis result.
 * Returns null when quality package/file metrics are missing.
 */
export function computeScoreSnapshot(
  result: AnalysisResult,
  percentileView: PercentileViewMode | string = "all",
  at: number = Date.now(),
): AnalysisScoreSnapshot | null {
  const view = parsePercentileViewMode(percentileView);
  const modularity =
    result.dsm?.metrics?.healthScore != null &&
    Number.isFinite(result.dsm.metrics.healthScore)
      ? Math.round(result.dsm.metrics.healthScore)
      : 100;

  const architectureReport = buildArchitectureHealth(result.quality, {
    percentileView: view,
    includeEntityLists: false,
    includeFileLists: false,
  });
  if (!architectureReport) return null;

  const overallReport = buildArchitectureHealth(result.quality, {
    modularityScore: modularity,
    percentileView: view,
    includeEntityLists: false,
    includeFileLists: false,
  });
  if (!overallReport) return null;

  const counts = analysisStatusCounts(result);
  const overallStats: OverallStatsSnapshot = {
    packages: counts.packages,
    files: counts.files,
    rules: counts.rules,
    passed: counts.passed,
    warnings: counts.warnings,
    failures: counts.failures,
  };

  const architectureMetrics = architectureMetricScores(architectureReport);

  let modularityMetrics: ModularityMetricsSnapshot | undefined;
  const m = result.dsm?.metrics;
  if (m) {
    modularityMetrics = {
      cycles: m.cycleCount ?? 0,
      nodesInCycles: m.nodesInCycles ?? 0,
      upperTrianglePct: pct01(m.upperTriangleDensity),
      couplingPct: pct01(m.couplingDensity),
      propagationPct: pct01(m.propagationCost),
      clusteredCostPct: pct01(m.clusteredCostNormalized),
      buses: m.busCount ?? 0,
    };
  }

  return {
    at,
    overall: overallReport.rating,
    architecture: architectureReport.rating,
    modularity,
    percentileView: view,
    overallStats,
    architectureMetrics,
    modularityMetrics,
  };
}

/** Append a snapshot and trim to MAX_SCORE_HISTORY (oldest first). */
export function appendScorePoint(
  points: AnalysisScoreSnapshot[],
  next: AnalysisScoreSnapshot,
  max = MAX_SCORE_HISTORY,
): AnalysisScoreSnapshot[] {
  const out = [...points, next];
  if (out.length <= max) return out;
  return out.slice(out.length - max);
}

function parseOverallStats(raw: unknown): OverallStatsSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const num = (k: string) =>
    typeof o[k] === "number" && Number.isFinite(o[k]) ? Math.round(o[k] as number) : null;
  const packages = num("packages");
  const files = num("files");
  const rules = num("rules");
  const passed = num("passed");
  const warnings = num("warnings");
  const failures = num("failures");
  if (
    packages == null ||
    files == null ||
    rules == null ||
    passed == null ||
    warnings == null ||
    failures == null
  ) {
    return undefined;
  }
  return { packages, files, rules, passed, warnings, failures };
}

function parseArchitectureMetrics(
  raw: unknown,
): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.round(v);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseModularityMetrics(
  raw: unknown,
): ModularityMetricsSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const num = (k: string) =>
    typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null;
  const cycles = num("cycles");
  const nodesInCycles = num("nodesInCycles");
  const upperTrianglePct = num("upperTrianglePct");
  const couplingPct = num("couplingPct");
  const propagationPct = num("propagationPct");
  const clusteredCostPct = num("clusteredCostPct");
  const buses = num("buses");
  if (
    cycles == null ||
    nodesInCycles == null ||
    upperTrianglePct == null ||
    couplingPct == null ||
    propagationPct == null ||
    clusteredCostPct == null ||
    buses == null
  ) {
    return undefined;
  }
  return {
    cycles: Math.round(cycles),
    nodesInCycles: Math.round(nodesInCycles),
    upperTrianglePct,
    couplingPct,
    propagationPct,
    clusteredCostPct,
    buses: Math.round(buses),
  };
}

export function parseScoreHistory(
  raw: unknown,
  projectRoot?: string,
): AnalysisScoreHistory | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if ((obj.version !== 1 && obj.version !== 2) || !Array.isArray(obj.points)) {
    return null;
  }
  const points: AnalysisScoreSnapshot[] = [];
  for (const p of obj.points) {
    if (!p || typeof p !== "object") continue;
    const row = p as Record<string, unknown>;
    if (typeof row.at !== "number" || !Number.isFinite(row.at)) continue;
    if (typeof row.overall !== "number") continue;
    if (typeof row.architecture !== "number") continue;
    if (typeof row.modularity !== "number") continue;
    points.push({
      at: row.at,
      overall: Math.round(row.overall),
      architecture: Math.round(row.architecture),
      modularity: Math.round(row.modularity),
      percentileView:
        typeof row.percentileView === "string" ? row.percentileView : "all",
      overallStats: parseOverallStats(row.overallStats),
      architectureMetrics: parseArchitectureMetrics(row.architectureMetrics),
      modularityMetrics: parseModularityMetrics(row.modularityMetrics),
    });
  }
  return {
    version: obj.version === 2 ? 2 : 1,
    projectRoot:
      typeof obj.projectRoot === "string"
        ? obj.projectRoot
        : (projectRoot ?? ""),
    points,
  };
}
