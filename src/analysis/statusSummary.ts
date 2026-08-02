import type { AnalysisResult } from "./types";

/** Counts used by the Analysis tab status card. */
export interface AnalysisStatusCounts {
  packages: number;
  files: number;
  rules: number;
  passed: number;
  warnings: number;
  failures: number;
  modularityHealth: number;
}

export function analysisStatusCounts(result: AnalysisResult): AnalysisStatusCounts {
  const packagesFromHierarchy = result.hierarchy?.packages?.length ?? 0;
  const packagesFromQuality = Object.keys(result.quality?.packages ?? {}).length;
  const packages =
    packagesFromHierarchy > 0
      ? packagesFromHierarchy
      : packagesFromQuality > 0
        ? packagesFromQuality
        : result.graph.nodes.filter((n) => n.kind === "package").length;

  const filesFromHierarchy = result.hierarchy?.files?.length ?? 0;
  const filesFromQualityFiles = Object.keys(result.quality?.files ?? {}).length;
  const filesFromPackages = Object.values(result.quality?.packages ?? {}).reduce(
    (sum, pkg) => sum + (pkg.fileCount ?? 0),
    0,
  );
  const files =
    filesFromHierarchy > 0
      ? filesFromHierarchy
      : filesFromQualityFiles > 0
        ? filesFromQualityFiles
        : filesFromPackages;

  const passed = result.validation.filter((v) => v.status === "pass").length;
  const warnings = result.validation.filter((v) => v.status === "warn").length;
  const failures = result.validation.filter((v) => v.status === "fail").length;

  return {
    packages,
    files,
    rules: result.validation.length,
    passed,
    warnings,
    failures,
    modularityHealth: Math.round(result.dsm?.metrics.healthScore ?? 100),
  };
}

/** Same format as the Rust analysis summary line. */
export function formatAnalysisStatusSummary(result: AnalysisResult): string {
  if (result.summary?.startsWith("Analyzed ")) {
    return result.summary;
  }
  const c = analysisStatusCounts(result);
  return (
    `Analyzed ${c.packages} packages (${c.files} source files) with ${c.rules} rule(s): ` +
    `${c.passed} passed, ${c.warnings} warnings, ${c.failures} failures` +
    ` · modularity health ${c.modularityHealth}`
  );
}

export type AnalysisStatusTone = "ok" | "warn" | "fail";

export function analysisStatusTone(result: AnalysisResult): AnalysisStatusTone {
  const c = analysisStatusCounts(result);
  if (c.failures > 0) return "fail";
  if (c.warnings > 0) return "warn";
  return "ok";
}
