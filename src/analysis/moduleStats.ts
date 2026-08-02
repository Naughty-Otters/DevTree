import type { FileInfo, HierarchyIndex } from "./types";

/** Aligns with modularity / file_size rule defaults. */
export const SIZE_HEALTH_P90_HEALTHY = 200;
export const SIZE_HEALTH_P90_FAIR = 300;

export type SizeHealth = "healthy" | "fair" | "poor";

export interface LocPercentiles {
  p50: number;
  p80: number;
  p90: number;
}

export interface PackageModuleStats {
  kind: "package";
  fileCount: number;
  totalLoc: number;
  percentiles: LocPercentiles;
  health: SizeHealth;
}

export interface FileModuleStats {
  kind: "file";
  loc: number;
  /** 0–100 nearest-rank percentile of this file among peers (package, else project). */
  percentile: number;
  peerCount: number;
  peerScope: "package" | "project";
  health: SizeHealth;
}

export type ModuleStats = PackageModuleStats | FileModuleStats;

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return ".";
  return path.slice(0, idx);
}

/** Files scoped to a package/folder path (same rules as graph navigation). */
export function filesInPackage(
  hierarchy: HierarchyIndex,
  packagePath: string,
): FileInfo[] {
  if (hierarchy.packages.includes(packagePath)) {
    return hierarchy.files.filter((f) => f.package === packagePath);
  }
  if (packagePath === ".") {
    return hierarchy.files.filter((f) => f.package === ".");
  }
  return hierarchy.files.filter(
    (f) => f.path === packagePath || f.path.startsWith(`${packagePath}/`),
  );
}

/**
 * Nearest-rank percentile on a non-empty ascending sample.
 * `p` is in 0–100.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((clamped / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, rank))]!;
}

export function locPercentiles(locs: number[]): LocPercentiles {
  const sorted = [...locs].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p80: percentile(sorted, 80),
    p90: percentile(sorted, 90),
  };
}

/** Package size health from the p90 file size (lines). */
export function packageSizeHealth(p90: number): SizeHealth {
  if (p90 <= SIZE_HEALTH_P90_HEALTHY) return "healthy";
  if (p90 <= SIZE_HEALTH_P90_FAIR) return "fair";
  return "poor";
}

/**
 * File size health from its percentile rank among peers:
 * ≤50 healthy, ≤80 fair, else poor.
 */
export function fileSizeHealth(percentileRank: number): SizeHealth {
  if (percentileRank <= 50) return "healthy";
  if (percentileRank <= 80) return "fair";
  return "poor";
}

/** Empirical percentile rank of `value` in `sample` (0–100). */
export function percentileRank(sample: number[], value: number): number {
  if (sample.length === 0) return 0;
  let belowOrEqual = 0;
  for (const v of sample) {
    if (v <= value) belowOrEqual += 1;
  }
  return Math.round((belowOrEqual / sample.length) * 100);
}

export function computePackageStats(
  hierarchy: HierarchyIndex,
  packagePath: string,
): PackageModuleStats {
  const files = filesInPackage(hierarchy, packagePath);
  const locs = files.map((f) => f.loc);
  const percentiles = locPercentiles(locs);
  return {
    kind: "package",
    fileCount: files.length,
    totalLoc: locs.reduce((sum, n) => sum + n, 0),
    percentiles,
    health: files.length === 0 ? "healthy" : packageSizeHealth(percentiles.p90),
  };
}

export function computeFileStats(
  hierarchy: HierarchyIndex,
  filePath: string,
): FileModuleStats {
  const file = hierarchy.files.find((f) => f.path === filePath);
  const loc = file?.loc ?? 0;
  const pkg = file?.package ?? parentDir(filePath);
  let peers = filesInPackage(hierarchy, pkg).map((f) => f.loc);
  let peerScope: "package" | "project" = "package";
  if (peers.length <= 1) {
    peers = hierarchy.files.map((f) => f.loc);
    peerScope = "project";
  }
  const rank = percentileRank(peers, loc);
  return {
    kind: "file",
    loc,
    percentile: rank,
    peerCount: peers.length,
    peerScope,
    health: fileSizeHealth(rank),
  };
}

export function computeModuleStats(
  hierarchy: HierarchyIndex | null,
  node: { kind?: string; path: string; loc: number; line?: number },
): ModuleStats | null {
  if (!hierarchy) return null;
  const kind = node.kind || "";
  if (kind === "package" || kind === "folder") {
    return computePackageStats(hierarchy, node.path);
  }
  if (kind === "file" || kind === "module") {
    return computeFileStats(hierarchy, node.path);
  }
  return null;
}

export function sizeHealthLabel(health: SizeHealth): string {
  switch (health) {
    case "healthy":
      return "Healthy";
    case "fair":
      return "Fair";
    case "poor":
      return "Poor";
  }
}
