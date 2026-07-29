import type { Graph } from "../graph/types";

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

export interface AnalysisResult {
  graph: Graph;
  hierarchy: HierarchyIndex;
  validation: ValidationItem[];
  suggestions: SuggestionItem[];
  summary: string;
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
