import type { HierarchyIndex } from "../analysis/types";
import type { GraphNode } from "./types";

/** Languages DevTree analyzes (mirrors Rust LSP/linter extension maps). */
export type GraphLanguageId =
  | "typescript"
  | "rust"
  | "python"
  | "go"
  | "other";

export interface LanguageFilterFlags {
  typescript: boolean;
  rust: boolean;
  python: boolean;
  go: boolean;
  other: boolean;
}

export const DEFAULT_LANGUAGE_FILTERS: LanguageFilterFlags = {
  typescript: true,
  rust: true,
  python: true,
  go: true,
  other: true,
};

export const LANGUAGE_FILTER_OPTIONS: {
  key: keyof LanguageFilterFlags;
  label: string;
  hint: string;
}[] = [
  {
    key: "typescript",
    label: "TypeScript / JavaScript",
    hint: ".ts .tsx .js .jsx .mjs .cjs",
  },
  {
    key: "rust",
    label: "Rust",
    hint: ".rs",
  },
  {
    key: "python",
    label: "Python",
    hint: ".py",
  },
  {
    key: "go",
    label: "Go",
    hint: ".go",
  },
  {
    key: "other",
    label: "Other / unknown",
    hint: "Unrecognized extensions or modules with no source files yet",
  },
];

export function parseLanguageFilters(value: unknown): LanguageFilterFlags {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_LANGUAGE_FILTERS };
  }
  const v = value as Record<string, unknown>;
  return {
    typescript: v.typescript !== false,
    rust: v.rust !== false,
    python: v.python !== false,
    go: v.go !== false,
    other: v.other !== false,
  };
}

export function allLanguageFiltersEnabled(flags: LanguageFilterFlags): boolean {
  return (
    flags.typescript &&
    flags.rust &&
    flags.python &&
    flags.go &&
    flags.other
  );
}

/** Map a relative path to a language id; directories / extensionless → null. */
export function languageFromPath(path: string): GraphLanguageId | null {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "typescript";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "go":
      return "go";
    default:
      return "other";
  }
}

function addLang(
  map: Map<string, Set<GraphLanguageId>>,
  key: string,
  lang: GraphLanguageId,
): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(lang);
}

/**
 * Build package/folder/file → languages from hierarchy files.
 * Keys include package ids, file paths, and ancestor folder prefixes.
 */
export function buildLanguageIndex(
  hierarchy: HierarchyIndex | null | undefined,
): Map<string, Set<GraphLanguageId>> {
  const map = new Map<string, Set<GraphLanguageId>>();
  if (!hierarchy) return map;

  for (const file of hierarchy.files) {
    const lang = languageFromPath(file.path) ?? "other";
    addLang(map, file.path, lang);
    const pkg = file.package || ".";
    addLang(map, pkg, lang);
    if (pkg !== ".") addLang(map, ".", lang);

    const parts = file.path.split("/");
    // Ancestor folders: "a/b/c.ts" → "a", "a/b"
    for (let i = 1; i < parts.length; i++) {
      addLang(map, parts.slice(0, i).join("/"), lang);
    }
  }
  return map;
}

export function languagesForNode(
  node: GraphNode,
  index: Map<string, Set<GraphLanguageId>>,
): Set<GraphLanguageId> {
  const fromIndex = index.get(node.id) ?? index.get(node.path);
  if (fromIndex && fromIndex.size > 0) {
    return new Set(fromIndex);
  }
  const fromPath = languageFromPath(node.path);
  if (fromPath) return new Set([fromPath]);
  // Package / folder with no known files yet — treat as unknown.
  return new Set();
}

export function nodeMatchesLanguageFilters(
  node: GraphNode,
  flags: LanguageFilterFlags,
  index: Map<string, Set<GraphLanguageId>>,
): boolean {
  if (allLanguageFiltersEnabled(flags)) return true;

  const langs = languagesForNode(node, index);
  if (langs.size === 0) {
    // Unknown modules stay visible so slim package graphs aren't blanked out.
    return flags.other;
  }
  for (const lang of langs) {
    if (flags[lang]) return true;
  }
  return false;
}

export function visibleIdsForLanguageFilters(
  nodes: GraphNode[],
  flags: LanguageFilterFlags,
  index: Map<string, Set<GraphLanguageId>> = new Map(),
): Set<string> {
  const visible = new Set<string>();
  for (const node of nodes) {
    if (nodeMatchesLanguageFilters(node, flags, index)) {
      visible.add(node.id);
    }
  }
  return visible;
}

/** Languages present among the given nodes (for UI option lists). */
export function presentLanguages(
  nodes: GraphNode[],
  index: Map<string, Set<GraphLanguageId>>,
): GraphLanguageId[] {
  const found = new Set<GraphLanguageId>();
  for (const node of nodes) {
    const langs = languagesForNode(node, index);
    if (langs.size === 0) {
      found.add("other");
      continue;
    }
    for (const lang of langs) found.add(lang);
  }
  return LANGUAGE_FILTER_OPTIONS.map((o) => o.key).filter((k) => found.has(k));
}
