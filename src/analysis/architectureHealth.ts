/**
 * Architecture health ratings (0–100) from QualityIndex percentiles.
 * Higher is better. Lower-better metrics invert percentile rank.
 */
import { locPercentiles, type LocPercentiles } from "./moduleStats";
import { healthStatus } from "./dsm";
import {
  parsePercentileViewMode,
  type PercentileViewMode,
} from "./percentileView";
import type {
  FileQualityMetrics,
  PackageMetricRollup,
  PackageQualityMetrics,
  QualityIndex,
} from "./types";

export type HealthBand = "healthy" | "fair" | "poor";

export interface MetricSummaryRow {
  id: string;
  label: string;
  avg: number;
  display: string;
  unit?: string;
  percentiles: LocPercentiles;
  detail: string;
}

export interface RatedEntity {
  path: string;
  kind: "file" | "package";
  label: string;
  rating: number;
  band: HealthBand;
  fileCount?: number;
  loc: number;
}

export interface ArchitectureHealthReport {
  /** Project overall 0–100 (percentile-based quality). */
  rating: number;
  band: HealthBand;
  /** Statistic used for package/project rating (avg / p50 / p80 / p90). */
  percentileView: PercentileViewMode;
  /** Optional blend with DSM modularity when present. */
  modularityScore: number | null;
  fileCount: number;
  packageCount: number;
  totalLoc: number;
  metrics: MetricSummaryRow[];
  /** Packages sorted best→worst. */
  packages: RatedEntity[];
  /** Files sorted best→worst. */
  files: RatedEntity[];
  ratingByPath: Record<string, number>;
}

type Direction = "lower-better" | "higher-better";

interface FileMetricDef {
  id: string;
  label: string;
  key: keyof FileQualityMetrics;
  direction: Direction;
  weight: number;
  digits?: number;
  unit?: string;
  asPercent?: boolean;
}

interface AbsoluteThresholds {
  healthy: number;
  fair: number;
}

const FILE_METRIC_DEFS: Array<FileMetricDef & { thresholds: AbsoluteThresholds }> = [
  {
    id: "complexity",
    label: "Complexity",
    key: "cyclomatic",
    direction: "lower-better",
    weight: 1.1,
    thresholds: { healthy: 10, fair: 25 },
  },
  {
    id: "halstead",
    label: "Halstead",
    key: "halsteadVolume",
    direction: "lower-better",
    weight: 1,
    unit: "V",
    thresholds: { healthy: 500, fair: 2000 },
  },
  {
    id: "cognitive",
    label: "Cognitive",
    key: "cognitive",
    direction: "lower-better",
    weight: 1.1,
    thresholds: { healthy: 15, fair: 30 },
  },
  {
    id: "maintainability",
    label: "Maintain.",
    key: "maintainability",
    direction: "higher-better",
    weight: 1.4,
    unit: "/100",
    thresholds: { healthy: 70, fair: 50 },
  },
  {
    id: "cbo",
    label: "CBO",
    key: "cbo",
    direction: "lower-better",
    weight: 1,
    thresholds: { healthy: 5, fair: 12 },
  },
  {
    id: "coverage",
    label: "Coverage",
    key: "coverage",
    direction: "higher-better",
    weight: 1,
    asPercent: true,
    thresholds: { healthy: 80, fair: 50 },
  },
  {
    id: "issues",
    label: "Issues",
    key: "issueDensity",
    direction: "lower-better",
    weight: 1.2,
    digits: 1,
    unit: "/kLOC",
    thresholds: { healthy: 2, fair: 10 },
  },
  {
    id: "security",
    label: "Security",
    key: "securityDensity",
    direction: "lower-better",
    weight: 1.2,
    digits: 1,
    unit: "/kLOC",
    thresholds: { healthy: 0, fair: 2 },
  },
  {
    id: "aiQuality",
    label: "AI quality",
    key: "aiDensity",
    direction: "lower-better",
    weight: 0.9,
    digits: 1,
    unit: "/kLOC",
    thresholds: { healthy: 0, fair: 3 },
  },
  {
    id: "duplicatedCode",
    label: "Duplicated",
    key: "duplicatedPct",
    direction: "lower-better",
    weight: 1.2,
    digits: 1,
    asPercent: true,
    thresholds: { healthy: 5, fair: 20 },
  },
  {
    id: "deadCode",
    label: "Dead code",
    key: "deadCodePct",
    direction: "lower-better",
    weight: 1.1,
    digits: 1,
    asPercent: true,
    thresholds: { healthy: 10, fair: 40 },
  },
  {
    id: "staleDecisions",
    label: "Stale decisions",
    key: "staleDecisionDensity",
    direction: "lower-better",
    weight: 1.1,
    digits: 1,
    unit: "/kLOC",
    thresholds: { healthy: 1, fair: 8 },
  },
  {
    id: "nloc",
    label: "NLOC",
    key: "nloc",
    direction: "lower-better",
    weight: 0.5,
    unit: "lines",
    thresholds: { healthy: 150, fair: 350 },
  },
  {
    id: "cloc",
    label: "CLOC",
    key: "cloc",
    direction: "higher-better",
    weight: 0.4,
    unit: "lines",
    thresholds: { healthy: 8, fair: 2 },
  },
  {
    id: "codeDensity",
    label: "Code dens.",
    key: "codeDensity",
    direction: "higher-better",
    weight: 0.6,
    digits: 1,
    asPercent: true,
    thresholds: { healthy: 60, fair: 40 },
  },
  {
    id: "commentDensity",
    label: "Comment dens.",
    key: "commentDensity",
    direction: "higher-better",
    weight: 0.7,
    digits: 1,
    asPercent: true,
    thresholds: { healthy: 10, fair: 3 },
  },
  {
    id: "size",
    label: "Size",
    key: "loc",
    direction: "lower-better",
    weight: 0.5,
    unit: "LOC",
    thresholds: { healthy: 200, fair: 400 },
  },
];

interface PackageMetricDef {
  id: string;
  label: string;
  pick: (pkg: PackageQualityMetrics) => PackageMetricRollup | null | undefined;
  direction: Direction;
  weight: number;
  digits?: number;
  unit?: string;
  asPercent?: boolean;
}

const PACKAGE_METRIC_DEFS: PackageMetricDef[] = [
  { id: "complexity", label: "Complexity", pick: (p) => p.complexity, direction: "lower-better", weight: 1.1 },
  { id: "halstead", label: "Halstead", pick: (p) => p.halstead, direction: "lower-better", weight: 1, unit: "V" },
  { id: "cognitive", label: "Cognitive", pick: (p) => p.cognitive, direction: "lower-better", weight: 1.1 },
  {
    id: "maintainability",
    label: "Maintain.",
    pick: (p) => p.maintainability,
    direction: "higher-better",
    weight: 1.4,
    unit: "/100",
  },
  { id: "cbo", label: "CBO", pick: (p) => p.cbo, direction: "lower-better", weight: 1 },
  {
    id: "coverage",
    label: "Coverage",
    pick: (p) => p.coverage,
    direction: "higher-better",
    weight: 1,
    asPercent: true,
  },
  {
    id: "issues",
    label: "Issues",
    pick: (p) => p.issues,
    direction: "lower-better",
    weight: 1.2,
    digits: 1,
    unit: "/kLOC",
  },
  {
    id: "security",
    label: "Security",
    pick: (p) => p.security,
    direction: "lower-better",
    weight: 1.2,
    digits: 1,
    unit: "/kLOC",
  },
  {
    id: "aiQuality",
    label: "AI quality",
    pick: (p) => p.aiQuality,
    direction: "lower-better",
    weight: 0.9,
    digits: 1,
    unit: "/kLOC",
  },
  {
    id: "duplicatedCode",
    label: "Duplicated",
    pick: (p) => p.duplicatedCode,
    direction: "lower-better",
    weight: 1.2,
    digits: 1,
    asPercent: true,
  },
  {
    id: "deadCode",
    label: "Dead code",
    pick: (p) => p.deadCode,
    direction: "lower-better",
    weight: 1.1,
    digits: 1,
    asPercent: true,
  },
  {
    id: "staleDecisions",
    label: "Stale decisions",
    pick: (p) => p.staleDecisions,
    direction: "lower-better",
    weight: 1.1,
    digits: 1,
    unit: "/kLOC",
  },
  {
    id: "nloc",
    label: "NLOC",
    pick: (p) => p.nloc,
    direction: "lower-better",
    weight: 0.5,
    unit: "lines",
  },
  {
    id: "cloc",
    label: "CLOC",
    pick: (p) => p.cloc,
    direction: "higher-better",
    weight: 0.4,
    unit: "lines",
  },
  {
    id: "codeDensity",
    label: "Code dens.",
    pick: (p) => p.codeDensity,
    direction: "higher-better",
    weight: 0.6,
    digits: 1,
    asPercent: true,
  },
  {
    id: "commentDensity",
    label: "Comment dens.",
    pick: (p) => p.commentDensity,
    direction: "higher-better",
    weight: 0.7,
    digits: 1,
    asPercent: true,
  },
  { id: "size", label: "Size", pick: (p) => p.size, direction: "lower-better", weight: 0.5, unit: "LOC" },
];

function formatNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatPct(p: LocPercentiles, digits = 0): string {
  return `${formatNum(p.p50, digits)} / ${formatNum(p.p80, digits)} / ${formatNum(p.p90, digits)}`;
}

function bandForRating(rating: number): HealthBand {
  return healthStatus(rating);
}

/**
 * Peer-relative score 0–100 (higher = better).
 * lower-better: % of peers with value ≥ yours (best/lowest → 100).
 * higher-better: % of peers with value ≤ yours (best/highest → 100).
 * Ties / single sample → 100 (no relative penalty).
 */
function peerScore(
  sample: number[],
  value: number,
  direction: Direction,
): number {
  if (sample.length === 0) return 100;
  let favorable = 0;
  for (const v of sample) {
    if (direction === "lower-better") {
      if (v >= value) favorable += 1;
    } else if (v <= value) {
      favorable += 1;
    }
  }
  return Math.round((favorable / sample.length) * 100);
}

/** First index i with sorted[i] >= value (sorted ascending). */
function lowerBoundAsc(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index i with sorted[i] > value (sorted ascending). */
function upperBoundAsc(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Same as peerScore but O(log n) against a pre-sorted ascending sample. */
function peerScoreSorted(
  sortedAsc: number[],
  value: number,
  direction: Direction,
): number {
  const n = sortedAsc.length;
  if (n === 0) return 100;
  const favorable =
    direction === "lower-better"
      ? n - lowerBoundAsc(sortedAsc, value) // count v >= value
      : upperBoundAsc(sortedAsc, value); // count v <= value
  return Math.round((favorable / n) * 100);
}

function weightedScore(
  parts: Array<{ score: number; weight: number }>,
): number {
  let sum = 0;
  let w = 0;
  for (const p of parts) {
    if (!Number.isFinite(p.score)) continue;
    sum += p.score * p.weight;
    w += p.weight;
  }
  if (w <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(sum / w)));
}

function numericFileValue(file: FileQualityMetrics, key: keyof FileQualityMetrics): number | null {
  const v = file[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function rateFiles(files: FileQualityMetrics[]): RatedEntity[] {
  if (files.length === 0) return [];

  // Sort once per metric → O(n log n); rank each file in O(log n) instead of O(n²).
  const sortedSamples = new Map<string, number[]>();
  for (const def of FILE_METRIC_DEFS) {
    const vals: number[] = [];
    for (const f of files) {
      const v = numericFileValue(f, def.key);
      if (v != null) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    sortedSamples.set(def.id, vals);
  }

  return files.map((file) => {
    const parts: Array<{ score: number; weight: number }> = [];
    for (const def of FILE_METRIC_DEFS) {
      const v = numericFileValue(file, def.key);
      const sample = sortedSamples.get(def.id) ?? [];
      if (v == null || sample.length === 0) continue;
      parts.push({
        score: peerScoreSorted(sample, v, def.direction),
        weight: def.weight,
      });
    }
    const rating = weightedScore(parts);
    const label = file.path.includes("/")
      ? file.path.slice(file.path.lastIndexOf("/") + 1)
      : file.path;
    return {
      path: file.path,
      kind: "file" as const,
      label,
      rating,
      band: bandForRating(rating),
      loc: file.loc,
    };
  });
}

/** Package statistic used for peer rating under the active percentile view. */
function rollupStat(
  rollup: PackageMetricRollup,
  mode: PercentileViewMode,
): number | null {
  if (mode === "p50" || mode === "p80" || mode === "p90") {
    const v = rollup.percentiles[mode];
    return Number.isFinite(v) ? v : null;
  }
  // avg + all → compare package averages
  return Number.isFinite(rollup.avg) ? rollup.avg : null;
}

function ratePackages(
  packages: PackageQualityMetrics[],
  mode: PercentileViewMode,
): RatedEntity[] {
  if (packages.length === 0) return [];

  const sortedSamples = new Map<string, number[]>();
  for (const def of PACKAGE_METRIC_DEFS) {
    const vals: number[] = [];
    for (const pkg of packages) {
      const rollup = def.pick(pkg);
      if (!rollup) continue;
      const v = rollupStat(rollup, mode);
      if (v != null) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    sortedSamples.set(def.id, vals);
  }

  return packages.map((pkg) => {
    const parts: Array<{ score: number; weight: number }> = [];
    for (const def of PACKAGE_METRIC_DEFS) {
      const rollup = def.pick(pkg);
      const sample = sortedSamples.get(def.id) ?? [];
      if (!rollup || sample.length === 0) continue;
      const v = rollupStat(rollup, mode);
      if (v == null) continue;
      parts.push({
        score: peerScoreSorted(sample, v, def.direction),
        weight: def.weight,
      });
    }
    const rating = weightedScore(parts);
    const label =
      pkg.path === "." ? "(root)" : pkg.path.split("/").pop() ?? pkg.path;
    return {
      path: pkg.path,
      kind: "package" as const,
      label,
      rating,
      band: bandForRating(rating),
      fileCount: pkg.fileCount,
      loc: pkg.totalLoc,
    };
  });
}

function projectMetricsFromFiles(files: FileQualityMetrics[]): MetricSummaryRow[] {
  const rows: MetricSummaryRow[] = [];
  for (const def of FILE_METRIC_DEFS) {
    const vals: number[] = [];
    for (const f of files) {
      const v = numericFileValue(f, def.key);
      if (v != null) vals.push(v);
    }
    if (vals.length === 0) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const percentiles = locPercentiles(vals);
    const digits = def.digits ?? 0;
    const display = def.asPercent
      ? `${formatNum(avg, digits)}%`
      : formatNum(avg, digits);
    rows.push({
      id: def.id,
      label: def.label,
      avg,
      display,
      unit: def.unit,
      percentiles,
      detail: `Project file avg · p50/p80/p90 ${formatPct(percentiles, digits)}`,
    });
  }
  return rows;
}

/** Scorecard rows from package rollups when per-file quality is not loaded yet. */
function projectMetricsFromPackages(
  packages: PackageQualityMetrics[],
  mode: PercentileViewMode,
): MetricSummaryRow[] {
  const rows: MetricSummaryRow[] = [];
  for (const def of PACKAGE_METRIC_DEFS) {
    const fileDef = FILE_METRIC_DEFS.find((f) => f.id === def.id);
    if (!fileDef) continue;
    const vals: number[] = [];
    for (const pkg of packages) {
      const rollup = def.pick(pkg);
      if (!rollup) continue;
      const v = rollupStat(rollup, mode === "all" ? "avg" : mode);
      if (v != null) vals.push(v);
    }
    if (vals.length === 0) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const percentiles = locPercentiles(vals);
    const digits = def.digits ?? fileDef.digits ?? 0;
    const unit = def.unit ?? fileDef.unit;
    const asPercent = def.asPercent ?? fileDef.asPercent;
    const display = asPercent
      ? `${formatNum(avg, digits)}%`
      : formatNum(avg, digits);
    rows.push({
      id: def.id,
      label: def.label,
      avg,
      display,
      unit,
      percentiles,
      detail: `Package ${mode} · p50/p80/p90 ${formatPct(percentiles, digits)}`,
    });
  }
  return rows;
}

function metricFocusValue(
  row: MetricSummaryRow,
  mode: PercentileViewMode,
): number {
  if (mode === "p50" || mode === "p80" || mode === "p90") {
    return row.percentiles[mode];
  }
  return row.avg;
}

/** Map a metric value to 0–100 using Codacy-style healthy/fair thresholds. */
function absoluteMetricScore(
  value: number,
  direction: Direction,
  healthy: number,
  fair: number,
): number {
  if (!Number.isFinite(value)) return 100;
  if (direction === "lower-better") {
    if (value <= healthy) return 100;
    if (value <= fair) {
      const t = (value - healthy) / Math.max(1e-9, fair - healthy);
      return Math.round(100 - 50 * t);
    }
    const over = (value - fair) / Math.max(1e-9, fair);
    return Math.round(Math.max(0, 50 - 50 * Math.min(1, over)));
  }
  // higher-better: healthy is min-good, fair is min-acceptable
  if (value >= healthy) return 100;
  if (value >= fair) {
    const t = (healthy - value) / Math.max(1e-9, healthy - fair);
    return Math.round(100 - 50 * t);
  }
  const under = (fair - value) / Math.max(1e-9, fair);
  return Math.round(Math.max(0, 50 - 50 * Math.min(1, under)));
}

/**
 * Overall project score from the selected distribution focus (avg/p50/p80/p90).
 * Uses absolute thresholds so switching percentile view moves the headline rating.
 */
function overallRatingFromView(
  rows: MetricSummaryRow[],
  mode: PercentileViewMode,
): number {
  const parts: Array<{ score: number; weight: number }> = [];
  for (const def of FILE_METRIC_DEFS) {
    const row = rows.find((r) => r.id === def.id);
    if (!row) continue;
    const value = metricFocusValue(row, mode);
    parts.push({
      score: absoluteMetricScore(
        value,
        def.direction,
        def.thresholds.healthy,
        def.thresholds.fair,
      ),
      weight: def.weight,
    });
  }
  return weightedScore(parts);
}

/**
 * Build architecture health for Analysis tab + module ratings.
 * Ratings are relative (percentile among peers in this project).
 * `percentileView` selects which package/project statistic drives ratings.
 */
export function buildArchitectureHealth(
  quality: QualityIndex | null | undefined,
  opts?: {
    modularityScore?: number | null;
    percentileView?: PercentileViewMode | null;
    /**
     * When false, skip rating every file/package for lists (Analysis tab summary).
     * Lists/ratingByPath are filled when true (default) or when a detail view needs them.
     */
    includeEntityLists?: boolean;
    /**
     * When entity lists are enabled, also rate every file (expensive on large projects).
     * Default true. Package-only lists stay cheap for the Package ratings tab.
     */
    includeFileLists?: boolean;
  },
): ArchitectureHealthReport | null {
  if (!quality) return null;
  const files = Object.values(quality.files);
  const packages = Object.values(quality.packages);
  if (files.length === 0 && packages.length === 0) return null;

  const percentileView = parsePercentileViewMode(opts?.percentileView ?? "all");
  // Prefer package rollups for the scorecard — scanning every file on paint freezes large repos.
  // Per-file lists still use quality.files when includeFileLists is on.
  const metrics =
    packages.length > 0
      ? projectMetricsFromPackages(packages, percentileView)
      : projectMetricsFromFiles(files);
  const includeEntityLists = opts?.includeEntityLists !== false;
  const includeFileLists = opts?.includeFileLists !== false;

  // Headline rating tracks the selected percentile/avg against absolute thresholds.
  let rating =
    metrics.length > 0
      ? overallRatingFromView(metrics, percentileView)
      : (() => {
          const rated = ratePackages(packages, percentileView);
          if (rated.length === 0) return 100;
          return Math.round(
            rated.reduce((sum, e) => sum + e.rating, 0) / rated.length,
          );
        })();

  const modularityScore =
    opts?.modularityScore != null && Number.isFinite(opts.modularityScore)
      ? Math.round(opts.modularityScore)
      : null;

  // Blend lightly with DSM modularity when available (architecture = quality + structure).
  if (modularityScore != null) {
    rating = Math.round(rating * 0.7 + modularityScore * 0.3);
  }

  let ratedFiles: RatedEntity[] = [];
  let ratedPackages: RatedEntity[] = [];
  const ratingByPath: Record<string, number> = {};
  if (includeEntityLists) {
    if (includeFileLists && files.length > 0) {
      ratedFiles = rateFiles(files).sort((a, b) => b.rating - a.rating);
    }
    ratedPackages = ratePackages(packages, percentileView).sort(
      (a, b) => b.rating - a.rating,
    );
    for (const e of ratedFiles) ratingByPath[e.path] = e.rating;
    for (const e of ratedPackages) ratingByPath[e.path] = e.rating;
  }

  const fileCount =
    files.length > 0
      ? files.length
      : packages.reduce((sum, p) => sum + (p.fileCount ?? 0), 0);
  const totalLoc =
    files.length > 0
      ? files.reduce((s, f) => s + f.loc, 0)
      : packages.reduce((s, p) => s + (p.totalLoc ?? 0), 0);

  return {
    rating: Math.max(0, Math.min(100, rating)),
    band: bandForRating(rating),
    percentileView,
    modularityScore,
    fileCount,
    packageCount: packages.length,
    totalLoc,
    metrics,
    packages: ratedPackages,
    files: ratedFiles,
    ratingByPath,
  };
}

/** Labels for architecture quality metric ids (for chart pickers). */
export const ARCHITECTURE_METRIC_OPTIONS: { id: string; label: string }[] =
  FILE_METRIC_DEFS.map((d) => ({ id: d.id, label: d.label }));

/**
 * Per-metric 0–100 scores from an architecture health report
 * (same absolute thresholds as the headline rating).
 */
export function architectureMetricScores(
  report: ArchitectureHealthReport,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of FILE_METRIC_DEFS) {
    const row = report.metrics.find((r) => r.id === def.id);
    if (!row) continue;
    out[def.id] = absoluteMetricScore(
      metricFocusValue(row, report.percentileView),
      def.direction,
      def.thresholds.healthy,
      def.thresholds.fair,
    );
  }
  return out;
}

/** Lookup a precomputed rating for a module path (file or package). */
export function ratingForPath(
  report: ArchitectureHealthReport | null | undefined,
  path: string,
): number | null {
  if (!report) return null;
  const v = report.ratingByPath[path];
  return typeof v === "number" ? v : null;
}

/**
 * Rate a single file/package against peers without building full entity lists.
 * Used by module details so opening one row stays responsive on large projects.
 */
export function ratingForQualityPath(
  quality: QualityIndex | null | undefined,
  path: string,
  percentileView?: PercentileViewMode | null,
): number | null {
  if (!quality) return null;
  const mode = parsePercentileViewMode(percentileView ?? "all");

  const file = quality.files[path];
  if (file) {
    const peers = Object.values(quality.files);
    if (peers.length === 0) return null;
    const samples = new Map<string, number[]>();
    for (const def of FILE_METRIC_DEFS) {
      const vals: number[] = [];
      for (const f of peers) {
        const v = numericFileValue(f, def.key);
        if (v != null) vals.push(v);
      }
      samples.set(def.id, vals);
    }
    const parts: Array<{ score: number; weight: number }> = [];
    for (const def of FILE_METRIC_DEFS) {
      const v = numericFileValue(file, def.key);
      const sample = samples.get(def.id) ?? [];
      if (v == null || sample.length === 0) continue;
      parts.push({
        score: peerScore(sample, v, def.direction),
        weight: def.weight,
      });
    }
    return weightedScore(parts);
  }

  const pkg = quality.packages[path];
  if (pkg) {
    const peers = Object.values(quality.packages);
    if (peers.length === 0) return null;
    const samples = new Map<string, number[]>();
    for (const def of PACKAGE_METRIC_DEFS) {
      const vals: number[] = [];
      for (const p of peers) {
        const rollup = def.pick(p);
        if (!rollup) continue;
        const v = rollupStat(rollup, mode);
        if (v != null) vals.push(v);
      }
      samples.set(def.id, vals);
    }
    const parts: Array<{ score: number; weight: number }> = [];
    for (const def of PACKAGE_METRIC_DEFS) {
      const rollup = def.pick(pkg);
      const sample = samples.get(def.id) ?? [];
      if (!rollup || sample.length === 0) continue;
      const v = rollupStat(rollup, mode);
      if (v == null) continue;
      parts.push({
        score: peerScore(sample, v, def.direction),
        weight: def.weight,
      });
    }
    return weightedScore(parts);
  }

  return null;
}

export function ratingBand(rating: number): HealthBand {
  return bandForRating(rating);
}
