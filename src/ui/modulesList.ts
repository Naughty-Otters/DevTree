import type { GraphNode } from "../graph/types";
import { createModuleFileIcon, createModuleFolderIcon } from "./icons";
import { nodeColor } from "../canvas/colors";
import { attachTooltip } from "./tooltip";

export interface ModulesListState {
  graphNodes: GraphNode[];
  visibleIds: Set<string>;
  searchQuery: string;
}

export interface ModulesListCallbacks {
  onFocus: (nodeId: string) => void;
  onVisibilityChange: (visibleIds: Set<string>) => void;
  onHighlight: (nodeId: string | null) => void;
  onShowDetails?: (nodeId: string, clientX: number, clientY: number) => void;
}

export function renderModulesList(
  container: HTMLElement,
  state: ModulesListState,
  callbacks: ModulesListCallbacks,
): void {
  const searchHadFocus =
    document.activeElement?.classList.contains("modules-search-input") ?? false;
  const searchCursor =
    searchHadFocus && document.activeElement instanceof HTMLInputElement
      ? document.activeElement.selectionStart
      : null;

  container.innerHTML = "";

  const searchWrap = document.createElement("div");
  searchWrap.className = "modules-search-wrap";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "modules-search-input";
  searchInput.placeholder = "Search modules…";
  searchInput.value = state.searchQuery;
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInput.addEventListener("input", () => {
    state.searchQuery = searchInput.value;
    renderModulesList(container, state, callbacks);
  });
  searchInput.addEventListener("keydown", (e) => e.stopPropagation());

  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  const toolbar = document.createElement("div");
  toolbar.className = "modules-toolbar";

  const showAll = document.createElement("button");
  showAll.className = "btn-text";
  showAll.textContent = "Show all";
  showAll.addEventListener("click", () => {
    for (const node of state.graphNodes) {
      state.visibleIds.add(node.id);
    }
    callbacks.onVisibilityChange(new Set(state.visibleIds));
    renderModulesList(container, state, callbacks);
  });

  const hideAll = document.createElement("button");
  hideAll.className = "btn-text";
  hideAll.textContent = "Hide all";
  hideAll.addEventListener("click", () => {
    state.visibleIds.clear();
    callbacks.onVisibilityChange(new Set());
    renderModulesList(container, state, callbacks);
  });

  toolbar.append(showAll, hideAll);
  container.appendChild(toolbar);

  if (state.graphNodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "Run analysis to list graph modules";
    container.appendChild(empty);
    restoreSearchFocus(container, searchHadFocus, searchCursor);
    return;
  }

  const query = state.searchQuery.trim().toLowerCase();
  const sorted = [...state.graphNodes].sort((a, b) => a.label.localeCompare(b.label));
  const filtered =
    query.length === 0
      ? sorted
      : sorted.filter(
          (node) =>
            node.label.toLowerCase().includes(query) ||
            node.path.toLowerCase().includes(query),
        );

  if (query.length > 0) {
    const count = document.createElement("div");
    count.className = "modules-search-count";
    count.textContent =
      filtered.length === 0
        ? "No matches"
        : `${filtered.length} of ${sorted.length} module${sorted.length === 1 ? "" : "s"}`;
    container.appendChild(count);
  }

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = query.length > 0 ? "No modules match your search" : "No modules";
    container.appendChild(empty);
    restoreSearchFocus(container, searchHadFocus, searchCursor);
    return;
  }

  for (const node of filtered) {
    container.appendChild(moduleRow(node, state, callbacks, query));
  }

  restoreSearchFocus(container, searchHadFocus, searchCursor);
}

function restoreSearchFocus(
  container: HTMLElement,
  hadFocus: boolean,
  cursor: number | null,
): void {
  if (!hadFocus) return;
  const input = container.querySelector<HTMLInputElement>(".modules-search-input");
  if (!input) return;
  input.focus();
  if (cursor != null) {
    input.setSelectionRange(cursor, cursor);
  }
}

function highlightMatch(text: string, query: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!query) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let start = 0;
  let index = lower.indexOf(q, start);

  while (index !== -1) {
    if (index > start) {
      fragment.appendChild(document.createTextNode(text.slice(start, index)));
    }
    const mark = document.createElement("mark");
    mark.className = "module-name-match";
    mark.textContent = text.slice(index, index + q.length);
    fragment.appendChild(mark);
    start = index + q.length;
    index = lower.indexOf(q, start);
  }

  if (start < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(start)));
  }

  return fragment;
}

function moduleRow(
  node: GraphNode,
  state: ModulesListState,
  callbacks: ModulesListCallbacks,
  searchQuery = "",
): HTMLElement {
  const row = document.createElement("div");
  row.className = "module-row";
  row.dataset.path = node.path;
  row.dataset.nodeId = node.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "module-visibility";
  checkbox.title = "Show/hide on graph";
  checkbox.checked = state.visibleIds.has(node.id);
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.visibleIds.add(node.id);
    } else {
      state.visibleIds.delete(node.id);
    }
    callbacks.onVisibilityChange(new Set(state.visibleIds));
  });

  const colorDot = document.createElement("span");
  colorDot.className = "module-color-dot";
  colorDot.style.backgroundColor = nodeColor(node.id);

  const icon =
    node.kind === "package" || node.kind === "folder"
      ? createModuleFolderIcon()
      : node.kind === "file" || node.kind === "module"
        ? createModuleFileIcon(node.label)
        : createModuleFileIcon(node.label);

  attachTooltip(
    icon,
    `${node.label}\n${node.path}\n${node.loc} lines · ${node.kind}`,
  );
  icon.style.cursor = "pointer";
  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = icon.getBoundingClientRect();
    callbacks.onShowDetails?.(node.id, rect.right, rect.top);
  });

  const name = document.createElement("span");
  name.className = "module-name";
  name.appendChild(highlightMatch(node.label, searchQuery));
  name.title = node.path;

  row.append(checkbox, colorDot, icon, name);

  row.addEventListener("mouseenter", () => {
    callbacks.onHighlight(node.id);
  });
  row.addEventListener("mouseleave", () => {
    callbacks.onHighlight(null);
  });

  row.addEventListener("click", () => {
    containerSelect(row);
    callbacks.onFocus(node.id);
  });

  return row;
}

function containerSelect(row: HTMLElement): void {
  const parent = row.closest("#modules-list");
  if (!parent) return;
  parent.querySelectorAll(".module-row.selected").forEach((el) => {
    el.classList.remove("selected");
  });
  row.classList.add("selected");
}
