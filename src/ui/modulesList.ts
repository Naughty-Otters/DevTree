import type { GraphNode } from "../graph/types";
import { openableSourceForNode } from "../graph/openSource";
import { createNodeKindShapeWrap, nodeKindLabel } from "../canvas/nodeIcons";
import { nodeColor } from "../canvas/colors";
import { t } from "../i18n";
import { createLoadingPlaceholder } from "./loadingPlaceholder";
import { appendPagedItems } from "./pagedList";
import { attachTooltip } from "./tooltip";

export interface ModulesListState {
  graphNodes: GraphNode[];
  visibleIds: Set<string>;
  searchQuery: string;
  /** True while graph/hierarchy is hydrating. */
  loading?: boolean;
}

export interface ModulesListCallbacks {
  onFocus: (nodeId: string) => void;
  onVisibilityChange: (visibleIds: Set<string>) => void;
  onHighlight: (nodeId: string | null) => void;
  onShowDetails?: (nodeId: string, clientX: number, clientY: number) => void;
  /** Navigate to this module on the Graph (e.g. double-click a file). */
  onOpenFile?: (path: string) => void;
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
  searchInput.placeholder = t("modules.search");
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
  showAll.textContent = t("modules.showAll");
  showAll.addEventListener("click", () => {
    for (const node of state.graphNodes) {
      state.visibleIds.add(node.id);
    }
    callbacks.onVisibilityChange(new Set(state.visibleIds));
    renderModulesList(container, state, callbacks);
  });

  const hideAll = document.createElement("button");
  hideAll.className = "btn-text";
  hideAll.textContent = t("modules.hideAll");
  hideAll.addEventListener("click", () => {
    state.visibleIds.clear();
    callbacks.onVisibilityChange(new Set());
    renderModulesList(container, state, callbacks);
  });

  toolbar.append(showAll, hideAll);
  container.appendChild(toolbar);

  if (state.graphNodes.length === 0) {
    if (state.loading) {
      container.appendChild(
        createLoadingPlaceholder({
          title: t("modules.loading"),
          detail: t("modules.loadingDetail"),
          size: "panel",
        }),
      );
    } else {
      const empty = document.createElement("div");
      empty.className = "panel-empty";
      empty.textContent = t("modules.empty");
      container.appendChild(empty);
    }
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
        ? t("modules.noMatches")
        : t(sorted.length === 1 ? "modules.countOne" : "modules.count", {
            filtered: filtered.length,
            total: sorted.length,
          });
    container.appendChild(count);
  }

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent =
      query.length > 0 ? t("modules.noSearchMatches") : t("modules.none");
    container.appendChild(empty);
    restoreSearchFocus(container, searchHadFocus, searchCursor);
    return;
  }

  const pageHost = document.createElement("div");
  pageHost.className = "modules-paged-list";
  container.appendChild(pageHost);
  appendPagedItems(
    pageHost,
    filtered,
    (node) => moduleRow(node, state, callbacks, query),
    100,
  );

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
  checkbox.title = t("modules.visibilityToggle");
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

  const icon = createNodeKindShapeWrap(node.kind || "symbol");

  attachTooltip(
    icon,
    `${node.label}\n${node.path}\n${t("modules.tooltipMeta", {
      loc: node.loc,
      kind: nodeKindLabel(node.kind || "symbol"),
    })}`,
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
    row.classList.add("module-row-hover");
    callbacks.onHighlight(node.id);
  });
  row.addEventListener("mouseleave", () => {
    row.classList.remove("module-row-hover");
    callbacks.onHighlight(null);
  });

  row.addEventListener("click", () => {
    // O(1) selection — avoid querySelectorAll over thousands of rows.
    const prev = row
      .closest("#modules-list, .modules-paged-list")
      ?.querySelector(".module-row.selected");
    if (prev && prev !== row) prev.classList.remove("selected");
    row.classList.add("selected");
    callbacks.onFocus(node.id);
  });

  row.addEventListener("dblclick", () => {
    const openable = openableSourceForNode(node);
    if (openable && callbacks.onOpenFile) {
      callbacks.onOpenFile(openable.path);
    }
  });

  return row;
}
