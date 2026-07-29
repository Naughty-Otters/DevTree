import type { TreeEntry } from "../project/types";
import { createChevron, createFileIcon, createFolderIcon } from "./icons";

export interface TreeCallbacks {
  onFileOpen: (path: string) => void;
  onFolderSelect?: (path: string) => void;
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
  ul.appendChild(renderNode(tree, callbacks));
  container.appendChild(ul);
}

function renderNode(
  entry: TreeEntry,
  callbacks: TreeCallbacks,
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "tree-node";
  const isDir = entry.kind === "directory";
  const hasChildren = Boolean(isDir && entry.children && entry.children.length > 0);

  const row = document.createElement("div");
  row.className = "tree-row";
  row.dataset.path = entry.path;

  const chevronWrap = document.createElement("span");
  chevronWrap.className = hasChildren ? "tree-chevron-wrap" : "tree-chevron-wrap tree-chevron-spacer";

  const iconWrap = document.createElement("span");
  iconWrap.className = "tree-icon-wrap";

  const setExpanded = (expanded: boolean) => {
    chevronWrap.innerHTML = "";
    chevronWrap.appendChild(createChevron(expanded));
    iconWrap.innerHTML = "";
    iconWrap.appendChild(isDir ? createFolderIcon(expanded) : createFileIcon(entry.name));
  };

  setExpanded(hasChildren);

  row.append(chevronWrap, iconWrap);

  const label = document.createElement("span");
  label.className = "tree-label";
  label.textContent = entry.name;
  row.appendChild(label);

  if (hasChildren) {
    li.classList.add("expanded");

    const toggle = () => {
      const expanded = li.classList.toggle("expanded");
      setExpanded(expanded);
    };

    chevronWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });

    row.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      toggle();
    });
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

  li.appendChild(row);

  if (hasChildren) {
    const children = document.createElement("ul");
    children.className = "tree-children";
    for (const child of entry.children!) {
      children.appendChild(renderNode(child, callbacks));
    }
    li.appendChild(children);
  }

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
