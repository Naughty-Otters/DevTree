import type { TreeEntry } from "../project/types";
import { createChevron, createFileIcon, createFolderIcon } from "./icons";
import { createLoadingPlaceholder } from "./loadingPlaceholder";

export interface TreeCallbacks {
  onFileOpen: (path: string) => void;
  onFolderSelect?: (path: string) => void;
  /** Fetch one folder's children when expanding a shallow stub. */
  loadChildren?: (path: string) => Promise<TreeEntry[]>;
}

export function renderProjectTree(
  container: HTMLElement,
  tree: TreeEntry | null,
  callbacks: TreeCallbacks,
): void {
  container.innerHTML = "";
  if (!tree) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No project open";
    container.appendChild(empty);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "tree-root";
  // Root opens so top-level entries are visible; nested folders stay collapsed.
  ul.appendChild(renderNode(tree, callbacks, 0));
  container.appendChild(ul);
}

function entryMayHaveChildren(entry: TreeEntry): boolean {
  if (entry.kind !== "directory") return false;
  if (entry.children && entry.children.length > 0) return true;
  return Boolean(entry.has_children);
}

function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.kind === "directory" ? 0 : 1;
    const bDir = b.kind === "directory" ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function renderNode(
  entry: TreeEntry,
  callbacks: TreeCallbacks,
  depth: number,
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "tree-node";
  const isDir = entry.kind === "directory";
  const hasChildren = entryMayHaveChildren(entry);

  const row = document.createElement("div");
  row.className = "tree-row";
  row.dataset.path = entry.path;

  const chevronWrap = document.createElement("span");
  chevronWrap.className = hasChildren
    ? "tree-chevron-wrap"
    : "tree-chevron-wrap tree-chevron-spacer";

  const iconWrap = document.createElement("span");
  iconWrap.className = "tree-icon-wrap";

  const setExpanded = (expanded: boolean) => {
    chevronWrap.replaceChildren(createChevron(expanded));
    iconWrap.replaceChildren(
      isDir ? createFolderIcon(expanded) : createFileIcon(entry.name),
    );
  };

  // Only the project root starts open — never auto-expand nested folders.
  const startExpanded = depth === 0 && hasChildren;
  setExpanded(startExpanded);
  if (startExpanded) {
    li.classList.add("expanded");
  }

  row.append(chevronWrap, iconWrap);

  const label = document.createElement("span");
  label.className = "tree-label";
  label.textContent = entry.name;
  row.appendChild(label);

  // Row must be first in the <li> so the folder name stays above its children.
  li.appendChild(row);

  if (hasChildren) {
    let childrenBuilt = false;
    let loading = false;

    const clearChildLists = () => {
      for (const child of [...li.children]) {
        if (child.classList.contains("tree-children")) child.remove();
      }
    };

    const mountChildren = (kids: TreeEntry[]) => {
      clearChildLists();
      if (kids.length === 0) {
        entry.has_children = false;
        entry.children = [];
        chevronWrap.className = "tree-chevron-wrap tree-chevron-spacer";
        return;
      }
      entry.children = kids;
      entry.has_children = true;
      const children = document.createElement("ul");
      children.className = "tree-children";
      for (const child of sortTreeEntries(kids)) {
        // depth+1 → children render collapsed; expand is one folder at a time.
        children.appendChild(renderNode(child, callbacks, depth + 1));
      }
      li.appendChild(children);
    };

    const mountKnownChildren = (): boolean => {
      if (childrenBuilt) return true;
      if (entry.children && entry.children.length > 0) {
        childrenBuilt = true;
        mountChildren(entry.children);
        return true;
      }
      return false;
    };

    const fetchAndMountChildren = async (): Promise<boolean> => {
      if (mountKnownChildren()) return true;
      if (!callbacks.loadChildren || loading) return false;
      loading = true;
      label.classList.add("tree-loading");
      clearChildLists();
      const loadingRow = document.createElement("ul");
      loadingRow.className = "tree-children";
      const loadingItem = document.createElement("li");
      loadingItem.className = "tree-loading-row";
      loadingItem.appendChild(
        createLoadingPlaceholder({
          title: "Loading folder…",
          size: "inline",
        }),
      );
      loadingRow.appendChild(loadingItem);
      li.appendChild(loadingRow);
      li.classList.add("expanded");
      setExpanded(true);
      try {
        const kids = await callbacks.loadChildren(entry.path);
        childrenBuilt = true;
        mountChildren(kids);
        return kids.length > 0;
      } catch (err) {
        console.error("Failed to list folder", entry.path, err);
        childrenBuilt = false;
        loadingRow.remove();
        return false;
      } finally {
        loading = false;
        label.classList.remove("tree-loading");
      }
    };

    const toggle = () => {
      const willExpand = !li.classList.contains("expanded");
      if (willExpand) {
        // Sync path when children are already in memory (no flicker / test-friendly).
        if (mountKnownChildren()) {
          li.classList.add("expanded");
          setExpanded(true);
          return;
        }
        void fetchAndMountChildren().then((ok) => {
          if (!ok) return;
          li.classList.add("expanded");
          setExpanded(true);
        });
      } else {
        li.classList.remove("expanded");
        setExpanded(false);
      }
    };

    chevronWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });

    row.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      toggle();
    });

    if (startExpanded) {
      if (!mountKnownChildren()) {
        void fetchAndMountChildren();
      }
    }
  }

  row.addEventListener("click", (e) => {
    e.stopPropagation();
    containerSelect(row);
    if (isDir) {
      callbacks.onFolderSelect?.(entry.path);
    } else {
      callbacks.onFileOpen(entry.path);
    }
  });

  return li;
}

function containerSelect(row: HTMLElement): void {
  const root = row.closest(".tree-root");
  if (!root) return;
  root.querySelectorAll(".tree-row.selected").forEach((el) => {
    el.classList.remove("selected");
  });
  row.classList.add("selected");
}
