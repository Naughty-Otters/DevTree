import type { Graph } from "../graph/types";
import type { DsmResult } from "./dsm";

export interface SymbolInfo {
  id: string;
  label: string;
  kind: string;
  file: string;
  line: number;
}

export interface SymbolEdge {
  source: string;
  target: string;
  kind: string;
}

export interface FileInfo {
  path: string;
  label: string;
  loc: number;
  package: string;
}

export interface PackageEdge {
  source: string;
  target: string;
  kind: string;
}

export interface ScopeGraph {
  nodes: {
    id: string;
    label: string;
    path: string;
    loc: number;
    kind: string;
  }[];
  edges: PackageEdge[];
}

export const HIERARCHY_VERSION = 3;

export interface HierarchyIndex {
  version?: number;
  files: FileInfo[];
  packages: string[];
  file_imports: Record<string, string[]>;
  package_edges: PackageEdge[];
  symbols: Record<string, SymbolInfo[]>;
  symbol_edges: SymbolEdge[];
  scope_graphs?: Record<string, ScopeGraph>;
}

export interface RuleSettingOption {
  value: string;
  label: string;
}

export interface RuleSettingDef {
  key: string;
  label: string;
  kind: "number" | "boolean" | "string" | "password" | "select";
  default: number | boolean | string;
  min?: number;
  max?: number;
  options?: RuleSettingOption[];
}

export interface AnalysisRule {
  id: string;
  name: string;
  description: string;
  category: string;
  settings?: RuleSettingDef[];
}

export type RuleSettingValue = number | boolean | string;

/** Per-rule setting values, keyed by rule id then setting key. */
export type RuleSettingsMap = Record<string, Record<string, RuleSettingValue>>;

export function defaultRuleSettings(rules: AnalysisRule[]): RuleSettingsMap {
  const out: RuleSettingsMap = {};
  for (const rule of rules) {
    const vals: Record<string, RuleSettingValue> = {};
    for (const s of rule.settings ?? []) {
      vals[s.key] = s.default;
    }
    if (Object.keys(vals).length > 0) {
      out[rule.id] = vals;
    }
  }
  return out;
}

export function mergeRuleSettings(
  rules: AnalysisRule[],
  saved: RuleSettingsMap | undefined | null,
): RuleSettingsMap {
  const defaults = defaultRuleSettings(rules);
  if (!saved) return defaults;
  const out: RuleSettingsMap = { ...defaults };
  for (const [ruleId, vals] of Object.entries(saved)) {
    out[ruleId] = { ...(out[ruleId] ?? {}), ...vals };
  }
  return out;
}

export interface ValidationItem {
  rule_id: string;
  rule_name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  affected: string[];
  cycle_groups?: CycleGroup[];
}

export interface CycleGroup {
  kind: "file_imports" | "package_imports" | "symbol_references" | string;
  nodes: string[];
  path: string[];
  label: string;
  node_count?: number;
}

export interface SuggestionItem {
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  targets: string[];
}

/** Precomputed percentiles for a package metric. */
export interface QualityPercentiles {
  p50: number;
  p80: number;
  p90: number;
}

export interface PackageMetricRollup {
  avg: number;
  percentiles: QualityPercentiles;
}

/** Per-file quality blob produced during analysis (native/WASM). */
export interface FileQualityMetrics {
  path: string;
  package?: string;
  loc: number;
  /** Non-comment lines of code. */
  nloc?: number;
  /** Comment lines of code. */
  cloc?: number;
  /** NLOC / LOC × 100. */
  codeDensity?: number;
  /** CLOC / (NLOC + CLOC) × 100. */
  commentDensity?: number;
  cyclomatic: number;
  structural: number;
  halsteadVolume: number;
  halsteadDifficulty: number;
  cognitive: number;
  maintainability: number;
  dit: number;
  cbo: number;
  coverage: number;
  issueDensity: number;
  securityDensity: number;
  aiDensity: number;
  duplicationHits: number;
  /** % of NLOC matching project-wide clone fingerprints. */
  duplicatedPct?: number;
  /** % of symbols with no inbound references. */
  deadCodePct?: number;
  /** TODO/FIXME/HACK-style markers per kLOC. */
  staleDecisionDensity?: number;
  documentationScore?: number | null;
}

export interface PackageQualityMetrics {
  path: string;
  fileCount: number;
  totalLoc: number;
  totalNloc?: number;
  totalCloc?: number;
  complexity: PackageMetricRollup;
  halstead: PackageMetricRollup;
  cognitive: PackageMetricRollup;
  maintainability: PackageMetricRollup;
  cbo: PackageMetricRollup;
  coverage: PackageMetricRollup;
  issues: PackageMetricRollup;
  security: PackageMetricRollup;
  aiQuality: PackageMetricRollup;
  duplication: PackageMetricRollup;
  duplicatedCode?: PackageMetricRollup;
  nloc?: PackageMetricRollup;
  cloc?: PackageMetricRollup;
  codeDensity?: PackageMetricRollup;
  commentDensity?: PackageMetricRollup;
  deadCode?: PackageMetricRollup;
  staleDecisions?: PackageMetricRollup;
  size: PackageMetricRollup;
  documentation?: PackageMetricRollup | null;
}

/** Precomputed quality index — UI must treat this as read-only O(1) lookup. */
export interface QualityIndex {
  files: Record<string, FileQualityMetrics>;
  packages: Record<string, PackageQualityMetrics>;
}

export interface AnalysisResult {
  graph: Graph;
  hierarchy: HierarchyIndex;
  validation: ValidationItem[];
  suggestions: SuggestionItem[];
  summary: string;
  /** Package-level DSM from last analysis; may be recomputed in the UI for scope/level. */
  dsm?: DsmResult | null;
  /** Precomputed metrics; prefer over on-the-fly calculation. */
  quality?: QualityIndex | null;
}

export interface RuleTaskProgress {
  ruleId: string;
  ruleName: string;
  status: "pending" | "running" | "done" | "failed";
  message?: string;
}

export interface AiValidationStream {
  ruleId: string;
  ruleName: string;
  thinking: string;
  text: string;
  activity?: string;
  /** Live / completed tool output (shell stdout, grep/read previews). */
  toolLog?: string;
  /** Token budget / usage line (e.g. `Tokens 12.4k / 50k`). */
  budget?: string;
  status: "running" | "done" | "failed";
}

export interface AnalysisProgress {
  analysisId: string;
  stage: string;
  message: string;
  current: number;
  total: number;
  percent: number;
  ruleTasks?: RuleTaskProgress[];
  aiStream?: AiValidationStream;
}
