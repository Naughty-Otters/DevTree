import type { HierarchyIndex, SymbolInfo, SymbolKindCounts } from "./types";

const FUNCTION_KINDS = new Set(["function", "method", "fn"]);
const VARIABLE_KINDS = new Set(["variable", "const", "constant", "let"]);
const STRUCTURE_KINDS = new Set([
  "class",
  "struct",
  "interface",
  "enum",
  "trait",
  "type",
]);

export function countSymbolsByKind(symbols: SymbolInfo[]): SymbolKindCounts {
  const counts: SymbolKindCounts = {
    functions: 0,
    variables: 0,
    structures: 0,
  };
  for (const s of symbols) {
    if (FUNCTION_KINDS.has(s.kind)) counts.functions += 1;
    else if (VARIABLE_KINDS.has(s.kind)) counts.variables += 1;
    else if (STRUCTURE_KINDS.has(s.kind)) counts.structures += 1;
  }
  return counts;
}

/** Resolve per-file symbol counts from persisted data or in-memory symbols. */
export function fileSymbolCounts(
  hierarchy: HierarchyIndex | null | undefined,
  filePath: string,
): SymbolKindCounts | null {
  if (!hierarchy) return null;

  const cached = hierarchy.symbol_counts?.[filePath];
  if (cached) return cached;

  const symbols = hierarchy.symbols[filePath];
  if (!symbols) return null;

  return countSymbolsByKind(symbols);
}
