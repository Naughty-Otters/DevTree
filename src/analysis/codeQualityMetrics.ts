/**
 * Codacy-inspired + classic software metrics for files and packages.
 * @see https://blog.codacy.com/code-quality-metrics
 */
import { parseAffectedEntry } from "../validation/parseAffected";
import {
  analyzeSourceClassicMetrics,
  couplingBetweenObjects,
  keywordComplexity,
  maintainabilityIndex,
  type SourceClassicMetrics,
} from "./classicComplexity";
import {
  filesInPackage,
  locPercentiles,
  packageSizeHealth,
  percentile,
  percentileRank,
  type LocPercentiles,
  type SizeHealth,
} from "./moduleStats";
import type { AnalysisResult, HierarchyIndex, ValidationItem } from "./types";

export type MetricId =
  | "complexity"
  | "halstead"
  | "cognitive"
  | "maintainability"
  | "dit"
  | "cbo"
  | "churn"
  | "coverage"
  | "security"
  | "documentation"
  | "duplication"
  | "issues"
  | "aiQuality"
  | "size";

/** Source-derived classic metrics attached after file enrichment. */
export type FileSourceMetrics = SourceClassicMetrics;

export type MetricDirection = "lower-better" | "higher-better";

export interface MetricScore {
  id: MetricId;
  label: string;
  /** Raw numeric value when available. */
  value: number | null;
  /** Short UI string. */
  display: string;
  unit?: string;
  health: SizeHealth | "unknown";
  direction: MetricDirection;
  /** Explains how the metric was derived. */
  detail: string;
  /** Package-only: distribution of per-file values. */
  percentiles?: LocPercentiles;
}

export interface FileChurnData {
  path: string;
  linesAdded: number;
  linesDeleted: number;
  commits: number;
}

export interface ChurnMap {
  available: boolean;
  days: number;
  byPath: Map<string, FileChurnData>;
  message?: string;
}

export interface QualityReport {
  kind: "file" | "package";
  path: string;
  fileCount: number;
  metrics: MetricScore[];
}

const SECURITY_RULE_RE =
  /security|xss|sql.?injection|secret|cve|vuln|auth|permission/i;
const AI_RULE_RE = /^ai_|^review_|^arch_|^clean_/;
const DUP_RULE_RE = /dry|duplicat|maintainability/i;
const DOC_RULE_RE = /comment|document|docstring/i;

function isTestPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  const lower = name.toLowerCase();
  return (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.endsWith("_test.go") ||
    lower.endsWith("_test.rs") ||
    lower.endsWith("_test.py") ||
    lower.startsWith("test_") ||
    path.includes("/__tests__/") ||
    path.includes("/tests/")
  );
}

function hasCompanionTest(hierarchy: HierarchyIndex, filePath: string): boolean {
  if (isTestPath(filePath)) return true;
  const stem =
    filePath
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "";
  const parent = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/"))
    : ".";
  const candidates = [
    `${parent}/${stem}.test.ts`,
    `${parent}/${stem}.spec.ts`,
    `${parent}/${stem}.test.tsx`,
    `${parent}/${stem}.spec.tsx`,
    `${parent}/${stem}.test.js`,
    `${parent}/${stem}_test.go`,
    `${parent}/${stem}_test.py`,
    `tests/${stem}.rs`,
    `${parent}/__tests__/${stem}.ts`,
  ];
  const paths = new Set(hierarchy.files.map((f) => f.path));
  return candidates.some((c) => paths.has(c));
}

function fileSymbols(hierarchy: HierarchyIndex, filePath: string): number {
  return (hierarchy.symbols[filePath] ?? []).length;
}

function fileInternalCalls(hierarchy: HierarchyIndex, filePath: string): number {
  const symbols = new Set((hierarchy.symbols[filePath] ?? []).map((s) => s.id));
  if (symbols.size === 0) return 0;
  let n = 0;
  for (const edge of hierarchy.symbol_edges ?? []) {
    if (symbols.has(edge.source) && symbols.has(edge.target)) n += 1;
  }
  return n;
}

function fileImportsOut(hierarchy: HierarchyIndex, filePath: string): number {
  return (hierarchy.file_imports[filePath] ?? []).length;
}

/** Structural complexity proxy (no AST): 1 + symbols + internal calls + imports. */
export function structuralComplexity(
  hierarchy: HierarchyIndex,
  filePath: string,
): number {
  return (
    1 +
    fileSymbols(hierarchy, filePath) +
    fileInternalCalls(hierarchy, filePath) +
    fileImportsOut(hierarchy, filePath)
  );
}

function fileCbo(hierarchy: HierarchyIndex, filePath: string): number {
  return couplingBetweenObjects(
    filePath,
    hierarchy.file_imports ?? {},
    hierarchy.symbols ?? {},
    hierarchy.symbol_edges ?? [],
  );
}

/** Approximate Halstead volume without full tokenization: N≈2*LOC, n≈symbols+imports+8. */
function approxHalsteadVolume(
  hierarchy: HierarchyIndex,
  filePath: string,
  loc: number,
): number {
  const n = Math.max(
    2,
    fileSymbols(hierarchy, filePath) + fileImportsOut(hierarchy, filePath) + 8,
  );
  const N = Math.max(2, loc * 2);
  return N * Math.log2(n);
}

function healthForLowerBetter(
  value: number,
  healthyMax: number,
  fairMax: number,
): SizeHealth {
  if (value <= healthyMax) return "healthy";
  if (value <= fairMax) return "fair";
  return "poor";
}

function healthForHigherBetter(
  value: number,
  healthyMin: number,
  fairMin: number,
): SizeHealth {
  if (value >= healthyMin) return "healthy";
  if (value >= fairMin) return "fair";
  return "poor";
}

function healthLabel(health: SizeHealth | "unknown"): string {
  switch (health) {
    case "healthy":
      return "Healthy";
    case "fair":
      return "Fair";
    case "poor":
      return "Poor";
    default:
      return "n/a";
  }
}

export { healthLabel };

interface FileIssueBucket {
  total: number;
  security: number;
  ai: number;
  duplication: number;
  documentation: number;
}

function emptyBucket(): FileIssueBucket {
  return { total: 0, security: 0, ai: 0, duplication: 0, documentation: 0 };
}

function categorizeItem(item: ValidationItem, bucket: FileIssueBucket): void {
  if (item.status === "pass") return;
  const weight = item.status === "fail" ? 2 : 1;
  bucket.total += weight;
  const id = `${item.rule_id} ${item.rule_name}`;
  if (SECURITY_RULE_RE.test(id)) bucket.security += weight;
  if (AI_RULE_RE.test(item.rule_id) || AI_RULE_RE.test(item.rule_name)) {
    bucket.ai += weight;
  }
  if (DUP_RULE_RE.test(id)) bucket.duplication += weight;
  if (DOC_RULE_RE.test(id)) bucket.documentation += weight;
}

/** Build per-file issue buckets from analysis validation items. */
export function buildIssueIndex(
  result: AnalysisResult | null,
): Map<string, FileIssueBucket> {
  const map = new Map<string, FileIssueBucket>();
  if (!result) return map;

  for (const item of result.validation) {
    if (item.status === "pass") continue;
    const seen = new Set<string>();
    for (const raw of item.affected) {
      const entry = parseAffectedEntry(raw);
      const file = entry.file;
      if (!file || seen.has(file)) continue;
      // Skip non-path affected strings.
      if (!file.includes("/") && !file.includes(".")) continue;
      seen.add(file);
      const bucket = map.get(file) ?? emptyBucket();
      categorizeItem(item, bucket);
      map.set(file, bucket);
    }
  }
  return map;
}

function densityPerKloc(count: number, loc: number): number {
  if (loc <= 0) return count > 0 ? count * 1000 : 0;
  return (count / loc) * 1000;
}

function churnTotal(c?: FileChurnData): number {
  if (!c) return 0;
  return c.linesAdded + c.linesDeleted;
}

function formatNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatPercentiles(p: LocPercentiles, digits = 0): string {
  return `${formatNum(p.p50, digits)} / ${formatNum(p.p80, digits)} / ${formatNum(p.p90, digits)}`;
}

function metric(
  partial: Omit<MetricScore, "health"> & { health?: MetricScore["health"] },
): MetricScore {
  return {
    ...partial,
    health: partial.health ?? "unknown",
  };
}

function fileCoverageScore(hierarchy: HierarchyIndex, path: string): number {
  return hasCompanionTest(hierarchy, path) ? 100 : 0;
}

function classicMetricsForFile(
  hierarchy: HierarchyIndex,
  filePath: string,
  loc: number,
  sourceMetrics?: FileSourceMetrics | null,
): {
  complexity: number;
  complexityDetail: string;
  halsteadVolume: number;
  halsteadDetail: string;
  cognitive: number;
  cognitiveDetail: string;
  maintainability: number;
  maintainabilityDetail: string;
  dit: number;
  ditDetail: string;
  cbo: number;
} {
  const cbo = fileCbo(hierarchy, filePath);
  const structural = structuralComplexity(hierarchy, filePath);

  if (sourceMetrics) {
    return {
      complexity: sourceMetrics.cyclomaticComplexity,
      complexityDetail: "Keyword cyclomatic estimate (decision points + 1)",
      halsteadVolume: sourceMetrics.halstead.volume,
      halsteadDetail: `Halstead volume · difficulty ${formatNum(sourceMetrics.halstead.difficulty, 1)} · effort ${formatNum(sourceMetrics.halstead.effort, 0)}`,
      cognitive: sourceMetrics.cognitiveComplexity,
      cognitiveDetail: "Cognitive complexity (control flow + nesting)",
      maintainability: sourceMetrics.maintainabilityIndex,
      maintainabilityDetail:
        "Maintainability Index 0–100 from Halstead volume, cyclomatic complexity, and LOC",
      dit: sourceMetrics.depthOfInheritance,
      ditDetail:
        "Depth of Inheritance (local extends/bases in this file; cross-file chains not resolved)",
      cbo,
    };
  }

  const volume = approxHalsteadVolume(hierarchy, filePath, loc);
  const mi = maintainabilityIndex(volume, structural, Math.max(1, loc));
  return {
    complexity: structural,
    complexityDetail:
      "Structural proxy: 1 + symbols + internal calls + imports",
    halsteadVolume: volume,
    halsteadDetail: "Approximate Halstead volume (refined when source loads)",
    cognitive: structural,
    cognitiveDetail:
      "Cognitive proxy from structural complexity (refined when source loads)",
    maintainability: mi,
    maintainabilityDetail:
      "Approximate Maintainability Index (refined when source loads)",
    dit: 0,
    ditDetail: "Depth of Inheritance needs source (shows after file loads)",
    cbo,
  };
}

function computeFileMetrics(
  hierarchy: HierarchyIndex,
  filePath: string,
  issues: Map<string, FileIssueBucket>,
  churn: ChurnMap | null,
  sourceMetrics?: FileSourceMetrics | null,
): MetricScore[] {
  const file = hierarchy.files.find((f) => f.path === filePath);
  const loc = file?.loc ?? 0;
  const bucket = issues.get(filePath) ?? emptyBucket();
  const classic = classicMetricsForFile(
    hierarchy,
    filePath,
    loc,
    sourceMetrics,
  );

  const coverage = fileCoverageScore(hierarchy, filePath);
  const issueDensity = densityPerKloc(bucket.total, loc);
  const securityDensity = densityPerKloc(bucket.security, loc);
  const aiDensity = densityPerKloc(bucket.ai, loc);
  const dupHits = bucket.duplication;
  const docHits = bucket.documentation;

  const churnData = churn?.byPath.get(filePath);
  const churnValue =
    churn?.available && churnData ? churnTotal(churnData) : null;

  // Documentation: invert finding pressure into a 0–100 score when findings exist;
  // otherwise unknown (no static docstring analyzer yet).
  let docScore: number | null = null;
  let docDetail =
    "Comment/doc coverage needs source analysis or documentation findings";
  if (docHits > 0) {
    docScore = Math.max(0, 100 - docHits * 25);
    docDetail = "Inferred from documentation/comment findings in last analysis";
  }

  const ditAvailable = sourceMetrics != null;

  return [
    metric({
      id: "complexity",
      label: "Complexity",
      value: classic.complexity,
      display: formatNum(classic.complexity),
      direction: "lower-better",
      health: healthForLowerBetter(classic.complexity, 10, 25),
      detail: classic.complexityDetail,
    }),
    metric({
      id: "halstead",
      label: "Halstead",
      value: classic.halsteadVolume,
      display: formatNum(classic.halsteadVolume, 0),
      unit: "V",
      direction: "lower-better",
      health: healthForLowerBetter(classic.halsteadVolume, 500, 2000),
      detail: classic.halsteadDetail,
    }),
    metric({
      id: "cognitive",
      label: "Cognitive",
      value: classic.cognitive,
      display: formatNum(classic.cognitive),
      direction: "lower-better",
      health: healthForLowerBetter(classic.cognitive, 15, 30),
      detail: classic.cognitiveDetail,
    }),
    metric({
      id: "maintainability",
      label: "Maintain.",
      value: classic.maintainability,
      display: formatNum(classic.maintainability, 0),
      unit: "/100",
      direction: "higher-better",
      health: healthForHigherBetter(classic.maintainability, 65, 40),
      detail: classic.maintainabilityDetail,
    }),
    metric({
      id: "dit",
      label: "DIT",
      value: ditAvailable ? classic.dit : null,
      display: ditAvailable ? formatNum(classic.dit) : "…",
      direction: "lower-better",
      health: ditAvailable
        ? healthForLowerBetter(classic.dit, 2, 4)
        : "unknown",
      detail: classic.ditDetail,
    }),
    metric({
      id: "cbo",
      label: "CBO",
      value: classic.cbo,
      display: formatNum(classic.cbo),
      direction: "lower-better",
      health: healthForLowerBetter(classic.cbo, 5, 12),
      detail:
        "Coupling Between Objects: unique imported / referenced files",
    }),
    metric({
      id: "churn",
      label: "Churn",
      value: churnValue,
      display:
        churnValue == null
          ? churn?.message
            ? "n/a"
            : "…"
          : formatNum(churnValue),
      unit: churnValue == null ? undefined : `lines/${churn?.days ?? 90}d`,
      direction: "lower-better",
      health:
        churnValue == null
          ? "unknown"
          : healthForLowerBetter(churnValue, 100, 400),
      detail:
        churnValue == null
          ? churn?.message ??
            "Git churn: lines added+deleted in the lookback window"
          : `${formatNum(churnData!.linesAdded)} added, ${formatNum(churnData!.linesDeleted)} deleted, ${formatNum(churnData!.commits)} commits`,
    }),
    metric({
      id: "coverage",
      label: "Coverage",
      value: coverage,
      display: `${coverage}%`,
      direction: "higher-better",
      health: coverage >= 100 ? "healthy" : "poor",
      detail:
        "Test-file presence proxy (companion .test/.spec/tests), not line coverage",
    }),
    metric({
      id: "security",
      label: "Security",
      value: securityDensity,
      display: formatNum(securityDensity, 1),
      unit: "/kLOC",
      direction: "lower-better",
      health: healthForLowerBetter(securityDensity, 0, 2),
      detail: "Security-related findings per 1000 lines from last analysis",
    }),
    metric({
      id: "documentation",
      label: "Docs",
      value: docScore,
      display: docScore == null ? "n/a" : `${formatNum(docScore)}%`,
      direction: "higher-better",
      health:
        docScore == null
          ? "unknown"
          : healthForHigherBetter(docScore, 80, 50),
      detail: docDetail,
    }),
    metric({
      id: "duplication",
      label: "Duplication",
      value: dupHits,
      display: formatNum(dupHits),
      unit: "hits",
      direction: "lower-better",
      health: healthForLowerBetter(dupHits, 0, 1),
      detail: "DRY / duplication findings from last analysis",
    }),
    metric({
      id: "issues",
      label: "Issues",
      value: issueDensity,
      display: formatNum(issueDensity, 1),
      unit: "/kLOC",
      direction: "lower-better",
      health: healthForLowerBetter(issueDensity, 2, 10),
      detail: "Weighted fail/warn findings per 1000 lines",
    }),
    metric({
      id: "aiQuality",
      label: "AI quality",
      value: aiDensity,
      display: formatNum(aiDensity, 1),
      unit: "/kLOC",
      direction: "lower-better",
      health: healthForLowerBetter(aiDensity, 0, 3),
      detail: "AI review / clean-code / architecture findings per 1000 lines",
    }),
    metric({
      id: "size",
      label: "Size",
      value: loc,
      display: formatNum(loc),
      unit: "LOC",
      direction: "lower-better",
      health: packageSizeHealth(loc),
      detail: "Lines of code",
    }),
  ];
}

function aggregatePackageMetric(
  id: MetricId,
  label: string,
  perFile: number[],
  direction: MetricDirection,
  opts: {
    unit?: string;
    detail: string;
    healthy: number;
    fair: number;
    digits?: number;
    asPercent?: boolean;
    emptyDisplay?: string;
  },
): MetricScore {
  if (perFile.length === 0) {
    return metric({
      id,
      label,
      value: null,
      display: opts.emptyDisplay ?? "—",
      unit: opts.unit,
      direction,
      health: "unknown",
      detail: opts.detail,
    });
  }

  const avg = perFile.reduce((a, b) => a + b, 0) / perFile.length;
  const percentiles = locPercentiles(perFile);
  const health =
    direction === "lower-better"
      ? healthForLowerBetter(percentiles.p90, opts.healthy, opts.fair)
      : healthForHigherBetter(percentiles.p50, opts.healthy, opts.fair);

  const digits = opts.digits ?? 0;
  const displayAvg = opts.asPercent
    ? `${formatNum(avg, digits)}%`
    : formatNum(avg, digits);

  return metric({
    id,
    label,
    value: avg,
    display: displayAvg,
    unit: opts.unit,
    direction,
    health,
    detail: `${opts.detail} · p50/p80/p90 ${formatPercentiles(percentiles, digits)}`,
    percentiles,
  });
}

function computePackageMetrics(
  hierarchy: HierarchyIndex,
  packagePath: string,
  issues: Map<string, FileIssueBucket>,
  churn: ChurnMap | null,
): MetricScore[] {
  const files = filesInPackage(hierarchy, packagePath);
  const paths = files.map((f) => f.path);
  const locs = files.map((f) => f.loc);
  const complexities = paths.map((p) => structuralComplexity(hierarchy, p));
  const coverages = paths.map((p) => fileCoverageScore(hierarchy, p));
  const issueDensities = files.map((f) =>
    densityPerKloc((issues.get(f.path) ?? emptyBucket()).total, f.loc),
  );
  const securityDensities = files.map((f) =>
    densityPerKloc((issues.get(f.path) ?? emptyBucket()).security, f.loc),
  );
  const aiDensities = files.map((f) =>
    densityPerKloc((issues.get(f.path) ?? emptyBucket()).ai, f.loc),
  );
  const dupHits = paths.map(
    (p) => (issues.get(p) ?? emptyBucket()).duplication,
  );
  const docScores = paths.map((p) => {
    const hits = (issues.get(p) ?? emptyBucket()).documentation;
    return hits > 0 ? Math.max(0, 100 - hits * 25) : 100;
  });
  const hasDocFindings = paths.some(
    (p) => (issues.get(p) ?? emptyBucket()).documentation > 0,
  );

  const churnValues = churn?.available
    ? paths.map((p) => churnTotal(churn.byPath.get(p)))
    : [];

  const sizePct = locPercentiles(locs);
  const halsteadVolumes = files.map((f) =>
    approxHalsteadVolume(hierarchy, f.path, f.loc),
  );
  const cognitives = complexities.slice();
  const maintainabilities = files.map((f, i) =>
    maintainabilityIndex(
      halsteadVolumes[i]!,
      complexities[i]!,
      Math.max(1, f.loc),
    ),
  );
  const cbos = paths.map((p) => fileCbo(hierarchy, p));

  return [
    aggregatePackageMetric("complexity", "Complexity", complexities, "lower-better", {
      detail: "Avg structural complexity across files",
      healthy: 10,
      fair: 25,
    }),
    aggregatePackageMetric("halstead", "Halstead", halsteadVolumes, "lower-better", {
      unit: "V",
      detail: "Avg approximate Halstead volume across files",
      healthy: 500,
      fair: 2000,
    }),
    aggregatePackageMetric("cognitive", "Cognitive", cognitives, "lower-better", {
      detail: "Avg cognitive proxy (structural complexity) across files",
      healthy: 15,
      fair: 30,
    }),
    aggregatePackageMetric(
      "maintainability",
      "Maintain.",
      maintainabilities,
      "higher-better",
      {
        unit: "/100",
        detail: "Avg Maintainability Index across files",
        healthy: 65,
        fair: 40,
      },
    ),
    metric({
      id: "dit",
      label: "DIT",
      value: null,
      display: "n/a",
      direction: "lower-better",
      health: "unknown",
      detail:
        "Depth of Inheritance needs per-file source; open a file module for DIT",
    }),
    aggregatePackageMetric("cbo", "CBO", cbos, "lower-better", {
      detail: "Avg Coupling Between Objects (unique coupled files)",
      healthy: 5,
      fair: 12,
    }),
    churn?.available
      ? aggregatePackageMetric("churn", "Churn", churnValues, "lower-better", {
          unit: `lines/${churn.days}d`,
          detail: "Avg git lines changed per file",
          healthy: 100,
          fair: 400,
        })
      : metric({
          id: "churn",
          label: "Churn",
          value: null,
          display: "n/a",
          direction: "lower-better",
          health: "unknown",
          detail: churn?.message ?? "Git churn unavailable",
        }),
    aggregatePackageMetric("coverage", "Coverage", coverages, "higher-better", {
      detail: "Share of files with a companion test file",
      healthy: 80,
      fair: 50,
      digits: 0,
      asPercent: true,
    }),
    aggregatePackageMetric(
      "security",
      "Security",
      securityDensities,
      "lower-better",
      {
        unit: "/kLOC",
        detail: "Avg security findings density",
        healthy: 0,
        fair: 2,
        digits: 1,
      },
    ),
    hasDocFindings
      ? aggregatePackageMetric(
          "documentation",
          "Docs",
          docScores,
          "higher-better",
          {
            detail: "Inferred documentation score from findings",
            healthy: 80,
            fair: 50,
            asPercent: true,
          },
        )
      : metric({
          id: "documentation",
          label: "Docs",
          value: null,
          display: "n/a",
          direction: "higher-better",
          health: "unknown",
          detail:
            "No documentation findings yet — enable comment/doc rules or AI clean-code lenses",
        }),
    aggregatePackageMetric("duplication", "Duplication", dupHits, "lower-better", {
      unit: "hits",
      detail: "Avg DRY/duplication hits per file",
      healthy: 0,
      fair: 1,
    }),
    aggregatePackageMetric("issues", "Issues", issueDensities, "lower-better", {
      unit: "/kLOC",
      detail: "Avg weighted issue density",
      healthy: 2,
      fair: 10,
      digits: 1,
    }),
    aggregatePackageMetric("aiQuality", "AI quality", aiDensities, "lower-better", {
      unit: "/kLOC",
      detail: "Avg AI-review finding density",
      healthy: 0,
      fair: 3,
      digits: 1,
    }),
    metric({
      id: "size",
      label: "Size",
      value: locs.reduce((a, b) => a + b, 0),
      display: formatNum(locs.reduce((a, b) => a + b, 0)),
      unit: "LOC",
      direction: "lower-better",
      health:
        files.length === 0 ? "healthy" : packageSizeHealth(sizePct.p90),
      detail: `Total LOC · file p50/p80/p90 ${formatPercentiles(sizePct)}`,
      percentiles: sizePct,
    }),
  ];
}

export function computeQualityReport(
  hierarchy: HierarchyIndex | null,
  node: { kind?: string; path: string },
  analysis: AnalysisResult | null,
  churn: ChurnMap | null = null,
  opts?: {
    sourceMetrics?: FileSourceMetrics | null;
    /** @deprecated use sourceMetrics */
    keywordComplexity?: number | null;
  },
): QualityReport | null {
  if (!hierarchy) return null;
  const kind = node.kind || "";
  const issues = buildIssueIndex(analysis);

  if (kind === "package" || kind === "folder") {
    const files = filesInPackage(hierarchy, node.path);
    return {
      kind: "package",
      path: node.path,
      fileCount: files.length,
      metrics: computePackageMetrics(hierarchy, node.path, issues, churn),
    };
  }

  if (kind === "file" || kind === "module") {
    let sourceMetrics = opts?.sourceMetrics ?? null;
    if (!sourceMetrics && opts?.keywordComplexity != null) {
      // Backward-compatible minimal source metrics from cyclomatic only.
      const loc =
        hierarchy.files.find((f) => f.path === node.path)?.loc ?? 1;
      const volume = approxHalsteadVolume(hierarchy, node.path, loc);
      sourceMetrics = {
        halstead: {
          distinctOperators: 1,
          distinctOperands: 1,
          totalOperators: 1,
          totalOperands: 1,
          vocabulary: 2,
          length: 2,
          volume,
          difficulty: 1,
          effort: volume,
        },
        cognitiveComplexity: opts.keywordComplexity,
        maintainabilityIndex: maintainabilityIndex(
          volume,
          opts.keywordComplexity,
          loc,
        ),
        depthOfInheritance: 0,
        cyclomaticComplexity: opts.keywordComplexity,
      };
    }
    return {
      kind: "file",
      path: node.path,
      fileCount: 1,
      metrics: computeFileMetrics(
        hierarchy,
        node.path,
        issues,
        churn,
        sourceMetrics,
      ),
    };
  }

  return null;
}

export { keywordComplexity, analyzeSourceClassicMetrics };

export function emptyChurnMap(days = 90, message?: string): ChurnMap {
  return {
    available: false,
    days,
    byPath: new Map(),
    message,
  };
}

export function churnMapFromResult(result: {
  available: boolean;
  days: number;
  files: Array<{
    path: string;
    linesAdded: number;
    linesDeleted: number;
    commits: number;
  }>;
  message?: string | null;
}): ChurnMap {
  const byPath = new Map<string, FileChurnData>();
  for (const f of result.files) {
    byPath.set(f.path, {
      path: f.path,
      linesAdded: f.linesAdded,
      linesDeleted: f.linesDeleted,
      commits: f.commits,
    });
  }
  return {
    available: result.available,
    days: result.days,
    byPath,
    message: result.message ?? undefined,
  };
}

/** Re-export helpers useful in tests / UI. */
export { percentile, percentileRank, formatPercentiles, healthForLowerBetter };
