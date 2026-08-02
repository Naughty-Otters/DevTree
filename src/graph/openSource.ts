import type { GraphNode } from "./types";

/** Project-relative path (+ optional line) that can be opened in the file viewer. */
export interface OpenableSource {
  path: string;
  line?: number;
}

/**
 * Resolve a graph node to an openable source file when the node is a file/module
 * or a symbol with a file path. Packages and folders stay graph-only.
 */
export function openableSourceForNode(node: GraphNode): OpenableSource | null {
  const kind = (node.kind || "").toLowerCase();
  if (kind === "package" || kind === "folder") return null;

  if (kind === "file" || kind === "module") {
    const path = (node.path || node.id).trim();
    if (!path) return null;
    return { path };
  }

  // Symbols and other leaf kinds that point at a source file.
  const path = (node.path || "").trim();
  if (!path) return null;
  const line = node.line && node.line > 0 ? node.line : undefined;
  return { path, line };
}

/** True when a rated / listed path is a file rather than a package scope. */
export function openableSourceForPath(
  path: string,
  kind?: string,
): OpenableSource | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  const k = (kind || "").toLowerCase();
  if (k === "package" || k === "folder") return null;
  if (k === "file" || k === "module") return { path: trimmed };
  // Heuristic when kind is unknown: paths with a file extension look openable.
  if (/\.[A-Za-z0-9]+$/.test(trimmed)) return { path: trimmed };
  return null;
}
