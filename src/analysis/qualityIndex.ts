/**
 * O(1) quality metric lookup from precomputed AnalysisResult.quality.
 * Hot path must not recompute Halstead / issue indexes / package loops.
 */
import type {
  FileQualityMetrics,
  PackageMetricRollup,
  PackageQualityMetrics,
  QualityIndex,
} from "./types";
import type { CcpMap, ChurnMap, MetricScore, QualityReport } from "./codeQualityMetrics";
import { packageSizeHealth, type SizeHealth } from "./moduleStats";

function formatNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatPercentiles(
  p: { p50: number; p80: number; p90: number },
  digits = 0,
): string {
  return `${formatNum(p.p50, digits)} / ${formatNum(p.p80, digits)} / ${formatNum(p.p90, digits)}`;
}

function healthLower(value: number, healthyMax: number, fairMax: number): SizeHealth {
  if (value <= healthyMax) return "healthy";
  if (value <= fairMax) return "fair";
  return "poor";
}

function healthHigher(value: number, healthyMin: number, fairMin: number): SizeHealth {
  if (value >= healthyMin) return "healthy";
  if (value >= fairMin) return "fair";
  return "poor";
}

function fromRollup(
  id: MetricScore["id"],
  label: string,
  rollup: PackageMetricRollup,
  direction: MetricScore["direction"],
  opts: {
    unit?: string;
    detail: string;
    healthy: number;
    fair: number;
    digits?: number;
    asPercent?: boolean;
  },
): MetricScore {
  const digits = opts.digits ?? 0;
  const health =
    direction === "lower-better"
      ? healthLower(rollup.percentiles.p90, opts.healthy, opts.fair)
      : healthHigher(rollup.percentiles.p50, opts.healthy, opts.fair);
  const display = opts.asPercent
    ? `${formatNum(rollup.avg, digits)}%`
    : formatNum(rollup.avg, digits);
  return {
    id,
    label,
    value: rollup.avg,
    display,
    unit: opts.unit,
    direction,
    health,
    detail: `${opts.detail} · p50/p80/p90 ${formatPercentiles(rollup.percentiles, digits)}`,
    percentiles: rollup.percentiles,
  };
}

function churnLines(churn: ChurnMap | null | undefined, path: string): number | null {
  if (!churn?.available) return null;
  const row = churn.byPath.get(path);
  if (!row) return 0;
  return row.linesAdded + row.linesDeleted;
}

function ccpForPath(ccp: CcpMap | null | undefined, path: string): number | null {
  if (!ccp?.available) return null;
  const row = ccp.byPath.get(path);
  if (!row || row.commits === 0) return ccp.projectCcp;
  return row.ccp;
}

function packageCcpMetric(
  pkg: PackageQualityMetrics,
  quality: QualityIndex,
  ccp: CcpMap | null | undefined,
): MetricScore {
  if (!ccp?.available) {
    return {
      id: "ccp",
      label: "CCP",
      value: null,
      display: ccp?.message ? "n/a" : "…",
      direction: "lower-better",
      health: "unknown",
      detail: ccp?.message ?? "Loading corrective commit probability…",
    };
  }

  const perFile: number[] = [];
  for (const file of Object.values(quality.files)) {
    if ((file.package || "") === pkg.path) {
      const row = ccp.byPath.get(file.path);
      if (row && row.commits > 0) perFile.push(row.ccp);
    }
  }

  if (perFile.length === 0) {
    return {
      id: "ccp",
      label: "CCP",
      value: ccp.projectCcp,
      display: `${formatNum(ccp.projectCcp, 1)}%`,
      direction: "lower-better",
      health: healthLower(ccp.projectCcp, 15, 35),
      detail: `Project corrective commit probability · last ${ccp.days}d`,
    };
  }

  const avg = perFile.reduce((a, b) => a + b, 0) / perFile.length;
  const sorted = [...perFile].sort((a, b) => a - b);
  const pct = (p: number) => {
    const rank = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]!;
  };
  const percentiles = { p50: pct(50), p80: pct(80), p90: pct(90) };
  return {
    id: "ccp",
    label: "CCP",
    value: avg,
    display: `${formatNum(avg, 1)}%`,
    direction: "lower-better",
    health: healthLower(percentiles.p90, 15, 35),
    detail: `Avg corrective commit probability · p50/p80/p90 ${formatPercentiles(percentiles, 1)}`,
    percentiles,
  };
}

function packageChurnMetric(
  pkg: PackageQualityMetrics,
  quality: QualityIndex,
  churn: ChurnMap | null | undefined,
): MetricScore {
  if (!churn?.available) {
    return {
      id: "churn",
      label: "Churn",
      value: null,
      display: churn?.message ? "n/a" : "…",
      direction: "lower-better",
      health: "unknown",
      detail: churn?.message ?? "Loading project git churn…",
    };
  }

  const perFile: number[] = [];
  for (const file of Object.values(quality.files)) {
    if ((file.package || "") === pkg.path) {
      perFile.push(churnLines(churn, file.path) ?? 0);
    }
  }

  if (perFile.length === 0) {
    return {
      id: "churn",
      label: "Churn",
      value: 0,
      display: "0",
      unit: `lines/${churn.days}d`,
      direction: "lower-better",
      health: "healthy",
      detail: "No git changes in lookback window",
    };
  }

  const avg = perFile.reduce((a, b) => a + b, 0) / perFile.length;
  const sorted = [...perFile].sort((a, b) => a - b);
  const pct = (p: number) => {
    const rank = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]!;
  };
  const percentiles = { p50: pct(50), p80: pct(80), p90: pct(90) };
  return {
    id: "churn",
    label: "Churn",
    value: avg,
    display: formatNum(avg),
    unit: `lines/${churn.days}d`,
    direction: "lower-better",
    health: healthLower(percentiles.p90, 100, 400),
    detail: `Avg git lines changed · p50/p80/p90 ${formatPercentiles(percentiles)}`,
    percentiles,
  };
}

function fileMetricsFromBlob(
  file: FileQualityMetrics,
  churn: ChurnMap | null | undefined,
  ccp?: CcpMap | null,
): MetricScore[] {
  const churnValue = churnLines(churn, file.path);
  const ccpValue = ccpForPath(ccp, file.path);
  return [
    {
      id: "complexity",
      label: "Complexity",
      value: file.cyclomatic,
      display: formatNum(file.cyclomatic),
      direction: "lower-better",
      health: healthLower(file.cyclomatic, 10, 25),
      detail: "Precomputed cyclomatic complexity",
    },
    {
      id: "cyclomaticDensity",
      label: "CC dens.",
      value: file.cyclomaticDensity ?? 0,
      display: formatNum(file.cyclomaticDensity ?? 0, 3),
      unit: "CC/NLOC",
      direction: "lower-better",
      health: healthLower(file.cyclomaticDensity ?? 0, 0.15, 0.35),
      detail: "Cyclomatic complexity density (CC / NLOC)",
    },
    {
      id: "abc",
      label: "ABC",
      value: file.abcMagnitude ?? 0,
      display: formatNum(file.abcMagnitude ?? 0, 1),
      direction: "lower-better",
      health: healthLower(file.abcMagnitude ?? 0, 20, 60),
      detail: `ABC ⟨${formatNum(file.abcAssignments ?? 0)}, ${formatNum(file.abcBranches ?? 0)}, ${formatNum(file.abcConditions ?? 0)}⟩ magnitude`,
    },
    {
      id: "halstead",
      label: "Halstead",
      value: file.halsteadVolume,
      display: formatNum(file.halsteadVolume),
      unit: "V",
      direction: "lower-better",
      health: healthLower(file.halsteadVolume, 500, 2000),
      detail: `Precomputed Halstead volume · difficulty ${formatNum(file.halsteadDifficulty, 1)}`,
    },
    {
      id: "cognitive",
      label: "Cognitive",
      value: file.cognitive,
      display: formatNum(file.cognitive),
      direction: "lower-better",
      health: healthLower(file.cognitive, 15, 30),
      detail: "Precomputed cognitive complexity",
    },
    {
      id: "maintainability",
      label: "Maintain.",
      value: file.maintainability,
      display: formatNum(file.maintainability),
      unit: "/100",
      direction: "higher-better",
      health: healthHigher(file.maintainability, 65, 40),
      detail: "Precomputed Maintainability Index",
    },
    {
      id: "dit",
      label: "DIT",
      value: file.dit,
      display: formatNum(file.dit),
      direction: "lower-better",
      health: healthLower(file.dit, 2, 4),
      detail: "Precomputed Depth of Inheritance",
    },
    {
      id: "cbo",
      label: "CBO",
      value: file.cbo,
      display: formatNum(file.cbo),
      direction: "lower-better",
      health: healthLower(file.cbo, 5, 12),
      detail: "Precomputed Coupling Between Objects",
    },
    {
      id: "cohesion",
      label: "Cohesion",
      value: file.cohesion ?? 100,
      display: `${formatNum(file.cohesion ?? 100, 0)}%`,
      direction: "higher-better",
      health: healthHigher(file.cohesion ?? 100, 70, 40),
      detail: "Intra-file symbol connectivity (higher = more cohesive)",
    },
    {
      id: "churn",
      label: "Churn",
      value: churnValue,
      display:
        churnValue == null ? (churn?.message ? "n/a" : "…") : formatNum(churnValue),
      unit: churnValue == null ? undefined : `lines/${churn?.days ?? 90}d`,
      direction: "lower-better",
      health: churnValue == null ? "unknown" : healthLower(churnValue, 100, 400),
      detail: "Git churn from project-wide cache",
    },
    {
      id: "ccp",
      label: "CCP",
      value: ccpValue,
      display:
        ccpValue == null
          ? ccp?.message
            ? "n/a"
            : "…"
          : `${formatNum(ccpValue, 1)}%`,
      direction: "lower-better",
      health: ccpValue == null ? "unknown" : healthLower(ccpValue, 15, 35),
      detail:
        ccpValue == null
          ? (ccp?.message ?? "Corrective Commit Probability from git history")
          : `Share of commits touching this file that look corrective · last ${ccp?.days ?? 90}d`,
    },
    {
      id: "coverage",
      label: "Coverage",
      value: file.coverage,
      display: `${formatNum(file.coverage)}%`,
      direction: "higher-better",
      health: file.coverage >= 100 ? "healthy" : "poor",
      detail: "Precomputed test-file presence",
    },
    {
      id: "security",
      label: "Security",
      value: file.securityDensity,
      display: formatNum(file.securityDensity, 1),
      unit: "/kLOC",
      direction: "lower-better",
      health: healthLower(file.securityDensity, 0, 2),
      detail: "Precomputed security finding density",
    },
    {
      id: "documentation",
      label: "Docs",
      value: file.documentationScore ?? null,
      display:
        file.documentationScore == null
          ? "n/a"
          : `${formatNum(file.documentationScore)}%`,
      direction: "higher-better",
      health:
        file.documentationScore == null
          ? "unknown"
          : healthHigher(file.documentationScore, 80, 50),
      detail: "Precomputed documentation score",
    },
    {
      id: "duplication",
      label: "Dup hits",
      value: file.duplicationHits,
      display: formatNum(file.duplicationHits),
      unit: "hits",
      direction: "lower-better",
      health: healthLower(file.duplicationHits, 0, 1),
      detail: "Validation duplication findings",
    },
    {
      id: "duplicatedCode",
      label: "Duplicated",
      value: file.duplicatedPct ?? 0,
      display: `${formatNum(file.duplicatedPct ?? 0, 1)}%`,
      direction: "lower-better",
      health: healthLower(file.duplicatedPct ?? 0, 5, 20),
      detail: "Clone fingerprint overlap vs project",
    },
    {
      id: "deadCode",
      label: "Dead code",
      value: file.deadCodePct ?? 0,
      display: `${formatNum(file.deadCodePct ?? 0, 1)}%`,
      direction: "lower-better",
      health: healthLower(file.deadCodePct ?? 0, 10, 40),
      detail: "Unreferenced symbols in this file",
    },
    {
      id: "staleDecisions",
      label: "Stale decisions",
      value: file.staleDecisionDensity ?? 0,
      display: formatNum(file.staleDecisionDensity ?? 0, 1),
      unit: "/kLOC",
      direction: "lower-better",
      health: healthLower(file.staleDecisionDensity ?? 0, 1, 8),
      detail: "TODO/FIXME/HACK/DEPRECATED markers per kLOC",
    },
    {
      id: "issues",
      label: "Issues",
      value: file.issueDensity,
      display: formatNum(file.issueDensity, 1),
      unit: "/kLOC",
      direction: "lower-better",
      health: healthLower(file.issueDensity, 2, 10),
      detail: "Precomputed issue density (bugs/defects proxy per kLOC)",
    },
    {
      id: "aiQuality",
      label: "AI quality",
      value: file.aiDensity,
      display: formatNum(file.aiDensity, 1),
      unit: "/kLOC",
      direction: "lower-better",
      health: healthLower(file.aiDensity, 0, 3),
      detail: "Precomputed AI finding density",
    },
    {
      id: "nloc",
      label: "NLOC",
      value: file.nloc ?? file.loc,
      display: formatNum(file.nloc ?? file.loc),
      unit: "lines",
      direction: "lower-better",
      health: packageSizeHealth(file.nloc ?? file.loc),
      detail: "Non-comment lines of code",
    },
    {
      id: "cloc",
      label: "CLOC",
      value: file.cloc ?? 0,
      display: formatNum(file.cloc ?? 0),
      unit: "lines",
      direction: "higher-better",
      health: healthHigher(file.cloc ?? 0, 5, 1),
      detail: "Comment lines of code",
    },
    {
      id: "codeDensity",
      label: "Code dens.",
      value: file.codeDensity ?? 0,
      display: `${formatNum(file.codeDensity ?? 0, 1)}%`,
      direction: "higher-better",
      health: healthHigher(file.codeDensity ?? 0, 60, 40),
      detail: "NLOC / LOC",
    },
    {
      id: "commentDensity",
      label: "Comment dens.",
      value: file.commentDensity ?? 0,
      display: `${formatNum(file.commentDensity ?? 0, 1)}%`,
      direction: "higher-better",
      health: healthHigher(file.commentDensity ?? 0, 10, 3),
      detail: "CLOC / (NLOC + CLOC)",
    },
    {
      id: "size",
      label: "Size",
      value: file.loc,
      display: formatNum(file.loc),
      unit: "LOC",
      direction: "lower-better",
      health: packageSizeHealth(file.loc),
      detail: "Physical lines of code",
    },
  ];
}

function packageMetricsFromBlob(
  pkg: PackageQualityMetrics,
  quality: QualityIndex,
  churn: ChurnMap | null | undefined,
  ccp?: CcpMap | null,
): MetricScore[] {
  return [
    fromRollup("complexity", "Complexity", pkg.complexity, "lower-better", {
      detail: "Precomputed avg cyclomatic complexity",
      healthy: 10,
      fair: 25,
    }),
    pkg.cyclomaticDensity
      ? fromRollup(
          "cyclomaticDensity",
          "CC dens.",
          pkg.cyclomaticDensity,
          "lower-better",
          {
            unit: "CC/NLOC",
            detail: "Avg cyclomatic complexity density",
            healthy: 0.15,
            fair: 0.35,
            digits: 3,
          },
        )
      : {
          id: "cyclomaticDensity",
          label: "CC dens.",
          value: null,
          display: "n/a",
          direction: "lower-better",
          health: "unknown",
          detail: "Re-run analysis for cyclomatic density",
        },
    pkg.abc
      ? fromRollup("abc", "ABC", pkg.abc, "lower-better", {
          detail: "Avg ABC magnitude √(A²+B²+C²)",
          healthy: 20,
          fair: 60,
          digits: 1,
        })
      : {
          id: "abc",
          label: "ABC",
          value: null,
          display: "n/a",
          direction: "lower-better",
          health: "unknown",
          detail: "Re-run analysis for ABC metric",
        },
    fromRollup("halstead", "Halstead", pkg.halstead, "lower-better", {
      unit: "V",
      detail: "Precomputed avg Halstead volume",
      healthy: 500,
      fair: 2000,
    }),
    fromRollup("cognitive", "Cognitive", pkg.cognitive, "lower-better", {
      detail: "Precomputed avg cognitive complexity",
      healthy: 15,
      fair: 30,
    }),
    fromRollup("maintainability", "Maintain.", pkg.maintainability, "higher-better", {
      unit: "/100",
      detail: "Precomputed avg Maintainability Index",
      healthy: 65,
      fair: 40,
    }),
    {
      id: "dit",
      label: "DIT",
      value: null,
      display: "n/a",
      direction: "lower-better",
      health: "unknown",
      detail: "Open a file for Depth of Inheritance",
    },
    fromRollup("cbo", "CBO", pkg.cbo, "lower-better", {
      detail: "Precomputed avg Coupling Between Objects",
      healthy: 5,
      fair: 12,
    }),
    pkg.cohesion
      ? fromRollup("cohesion", "Cohesion", pkg.cohesion, "higher-better", {
          detail: "Avg intra-file symbol cohesion",
          healthy: 70,
          fair: 40,
          asPercent: true,
        })
      : {
          id: "cohesion",
          label: "Cohesion",
          value: null,
          display: "n/a",
          direction: "higher-better",
          health: "unknown",
          detail: "Re-run analysis for cohesion",
        },
    packageChurnMetric(pkg, quality, churn),
    packageCcpMetric(pkg, quality, ccp),
    fromRollup("coverage", "Coverage", pkg.coverage, "higher-better", {
      detail: "Precomputed test-file presence rate",
      healthy: 80,
      fair: 50,
      asPercent: true,
    }),
    fromRollup("security", "Security", pkg.security, "lower-better", {
      unit: "/kLOC",
      detail: "Precomputed security density",
      healthy: 0,
      fair: 2,
      digits: 1,
    }),
    pkg.documentation
      ? fromRollup("documentation", "Docs", pkg.documentation, "higher-better", {
          detail: "Precomputed documentation score",
          healthy: 80,
          fair: 50,
          asPercent: true,
        })
      : {
          id: "documentation",
          label: "Docs",
          value: null,
          display: "n/a",
          direction: "higher-better",
          health: "unknown",
          detail: "No documentation findings in analysis",
        },
    fromRollup("duplication", "Dup hits", pkg.duplication, "lower-better", {
      unit: "hits",
      detail: "Validation duplication findings",
      healthy: 0,
      fair: 1,
    }),
    pkg.duplicatedCode
      ? fromRollup("duplicatedCode", "Duplicated", pkg.duplicatedCode, "lower-better", {
          detail: "Clone fingerprint overlap vs project",
          healthy: 5,
          fair: 20,
          digits: 1,
          asPercent: true,
        })
      : {
          id: "duplicatedCode",
          label: "Duplicated",
          value: null,
          display: "n/a",
          direction: "lower-better",
          health: "unknown",
          detail: "Re-run analysis for duplicated-code %",
        },
    pkg.deadCode
      ? fromRollup("deadCode", "Dead code", pkg.deadCode, "lower-better", {
          detail: "Unreferenced symbol share",
          healthy: 10,
          fair: 40,
          digits: 1,
          asPercent: true,
        })
      : {
          id: "deadCode",
          label: "Dead code",
          value: null,
          display: "n/a",
          direction: "lower-better",
          health: "unknown",
          detail: "Re-run analysis for dead-code %",
        },
    pkg.staleDecisions
      ? fromRollup(
          "staleDecisions",
          "Stale decisions",
          pkg.staleDecisions,
          "lower-better",
          {
            unit: "/kLOC",
            detail: "TODO/FIXME/HACK markers per kLOC",
            healthy: 1,
            fair: 8,
            digits: 1,
          },
        )
      : {
          id: "staleDecisions",
          label: "Stale decisions",
          value: null,
          display: "n/a",
          direction: "lower-better",
          health: "unknown",
          detail: "Re-run analysis for stale-decision density",
        },
    fromRollup("issues", "Issues", pkg.issues, "lower-better", {
      unit: "/kLOC",
      detail: "Precomputed issue density (bugs/defects proxy)",
      healthy: 2,
      fair: 10,
      digits: 1,
    }),
    fromRollup("aiQuality", "AI quality", pkg.aiQuality, "lower-better", {
      unit: "/kLOC",
      detail: "Precomputed AI finding density",
      healthy: 0,
      fair: 3,
      digits: 1,
    }),
    {
      id: "nloc",
      label: "NLOC",
      value: pkg.totalNloc ?? pkg.nloc?.avg ?? null,
      display: formatNum(pkg.totalNloc ?? pkg.nloc?.avg ?? 0),
      unit: "lines",
      direction: "lower-better",
      health: packageSizeHealth(pkg.nloc?.percentiles.p90 ?? pkg.totalNloc ?? 0),
      detail: `Total NLOC · file p50/p80/p90 ${formatPercentiles(pkg.nloc?.percentiles ?? { p50: 0, p80: 0, p90: 0 })}`,
      percentiles: pkg.nloc?.percentiles,
    },
    {
      id: "cloc",
      label: "CLOC",
      value: pkg.totalCloc ?? pkg.cloc?.avg ?? null,
      display: formatNum(pkg.totalCloc ?? pkg.cloc?.avg ?? 0),
      unit: "lines",
      direction: "higher-better",
      health: healthHigher(pkg.cloc?.percentiles.p50 ?? 0, 5, 1),
      detail: `Total CLOC · file p50/p80/p90 ${formatPercentiles(pkg.cloc?.percentiles ?? { p50: 0, p80: 0, p90: 0 })}`,
      percentiles: pkg.cloc?.percentiles,
    },
    pkg.codeDensity
      ? fromRollup("codeDensity", "Code dens.", pkg.codeDensity, "higher-better", {
          detail: "NLOC / LOC",
          healthy: 60,
          fair: 40,
          digits: 1,
          asPercent: true,
        })
      : {
          id: "codeDensity",
          label: "Code dens.",
          value: null,
          display: "n/a",
          direction: "higher-better",
          health: "unknown",
          detail: "Re-run analysis for code density",
        },
    pkg.commentDensity
      ? fromRollup(
          "commentDensity",
          "Comment dens.",
          pkg.commentDensity,
          "higher-better",
          {
            detail: "CLOC / (NLOC + CLOC)",
            healthy: 10,
            fair: 3,
            digits: 1,
            asPercent: true,
          },
        )
      : {
          id: "commentDensity",
          label: "Comment dens.",
          value: null,
          display: "n/a",
          direction: "higher-better",
          health: "unknown",
          detail: "Re-run analysis for comment density",
        },
    {
      id: "size",
      label: "Size",
      value: pkg.totalLoc,
      display: formatNum(pkg.totalLoc),
      unit: "LOC",
      direction: "lower-better",
      health: packageSizeHealth(pkg.size.percentiles.p90),
      detail: `Total LOC · file p50/p80/p90 ${formatPercentiles(pkg.size.percentiles)}`,
      percentiles: pkg.size.percentiles,
    },
  ];
}

/** Fast path: build a QualityReport from precomputed index (no heavy recalculation). */
export function qualityReportFromIndex(
  quality: QualityIndex | null | undefined,
  node: { kind?: string; path: string },
  churn?: ChurnMap | null,
  ccp?: CcpMap | null,
): QualityReport | null {
  if (!quality) return null;
  const kind = node.kind || "";

  if (kind === "package" || kind === "folder") {
    const pkg = quality.packages[node.path];
    if (!pkg) return null;
    return {
      kind: "package",
      path: node.path,
      fileCount: pkg.fileCount,
      metrics: packageMetricsFromBlob(pkg, quality, churn, ccp),
    };
  }

  if (kind === "file" || kind === "module") {
    const file = quality.files[node.path];
    if (!file) return null;
    return {
      kind: "file",
      path: node.path,
      fileCount: 1,
      metrics: fileMetricsFromBlob(file, churn, ccp),
    };
  }

  return null;
}
