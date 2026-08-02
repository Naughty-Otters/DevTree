import type { HierarchyIndex } from "../analysis/types";

/** Shared with boot/lazy loaders — empty stubs must not count as ready. */
export function hierarchyIsHydrated(
  hierarchy: HierarchyIndex | null | undefined,
): boolean {
  return Boolean(
    hierarchy && (hierarchy.files.length > 0 || hierarchy.packages.length > 0),
  );
}
