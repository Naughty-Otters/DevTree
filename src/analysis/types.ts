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

export const HIERARCHY_VERSION = 2;

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

export interface AnalysisRule {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface ValidationItem {
  rule_id: string;
  rule_name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  affected: string[];
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
