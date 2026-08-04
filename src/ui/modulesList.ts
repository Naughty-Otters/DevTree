import type { GraphEdge, GraphNode } from "../graph/types";
import { openableSourceForNode } from "../graph/openSource";
import { dependencyNeighborhood } from "../canvas/highlights";
import { createNodeKindShapeWrap, nodeKindLabel } from "../canvas/nodeIcons";
import { nodeColor } from "../canvas/colors";
import { t } from "../i18n";
import { lucideIcon } from "./icons";
import { createLoadingPlaceholder } from "./loadingPlaceholder";
import { appendPagedItems } from "./pagedList";
import { attachTooltip } from "./tooltip";
import { MoreHorizontal } from "lucide";

export interface ModulesListState {
  graphNodes: GraphNode[];
  /** Edges for the current graph view (related select/deselect). */
  graphEdges: GraphEdge[];
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
    (node) => moduleRow(node, state, callbacks, query, container),
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

function closeModuleActionsMenus(): void {
  document.querySelectorAll(".module-actions-menu").forEach((el) => el.remove());
  document.querySelectorAll(".module-row-menu-btn.is-open").forEach((el) => {
    el.classList.remove("is-open");
    el.setAttribute("aria-expanded", "false");
  });
}

function relatedIdsInView(nodeId: string, state: ModulesListState): string[] {
  const known = new Set(state.graphNodes.map((n) => n.id));
  const related = dependencyNeighborhood(nodeId, state.graphEdges);
  return [...related].filter((id) => known.has(id));
}

function openModuleActionsMenu(
  anchor: HTMLElement,
  node: GraphNode,
  state: ModulesListState,
  callbacks: ModulesListCallbacks,
  rerender: () => void,
): void {
  const alreadyOpen = anchor.classList.contains("is-open");
  closeModuleActionsMenus();
  if (alreadyOpen) return;

  const menu = document.createElement("div");
  menu.className = "module-actions-menu";
  menu.setAttribute("role", "menu");

  const selectRelated = document.createElement("button");
  selectRelated.type = "button";
  selectRelated.className = "module-actions-item";
  selectRelated.setAttribute("role", "menuitem");
  selectRelated.textContent = t("modules.selectRelated");
  selectRelated.addEventListener("click", (e) => {
    e.stopPropagation();
    // Keep only this module and its direct dependents/dependencies visible.
    const related = new Set(relatedIdsInView(node.id, state));
    state.visibleIds = related;
    callbacks.onVisibilityChange(new Set(state.visibleIds));
    closeModuleActionsMenus();
    rerender();
  });

  const deselectRelated = document.createElement("button");
  deselectRelated.type = "button";
  deselectRelated.className = "module-actions-item";
  deselectRelated.setAttribute("role", "menuitem");
  deselectRelated.textContent = t("modules.deselectRelated");
  deselectRelated.addEventListener("click", (e) => {
    e.stopPropagation();
    for (const id of relatedIdsInView(node.id, state)) {
      state.visibleIds.delete(id);
    }
    callbacks.onVisibilityChange(new Set(state.visibleIds));
    closeModuleActionsMenus();
    rerender();
  });

  menu.append(selectRelated, deselectRelated);
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.right - menuRect.width;
  let top = rect.bottom + 4;
  if (left < 8) left = 8;
  if (left + menuRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuRect.width - 8);
  }
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menuRect.height - 4);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  anchor.classList.add("is-open");
  anchor.setAttribute("aria-expanded", "true");

  const onDocPointer = (ev: Event) => {
    const target = ev.target as Node | null;
    if (menu.contains(target) || anchor.contains(target)) return;
    closeModuleActionsMenus();
    cleanup();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      closeModuleActionsMenus();
      cleanup();
    }
  };
  const cleanup = () => {
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey, true);
  };
  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("keydown", onKey, true);
}

function moduleRow(
  node: GraphNode,
  state: ModulesListState,
  callbacks: ModulesListCallbacks,
  searchQuery = "",
  listContainer: HTMLElement,
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

  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "module-row-menu-btn";
  menuBtn.setAttribute("aria-label", t("modules.actions"));
  menuBtn.setAttribute("aria-haspopup", "menu");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.title = t("modules.actions");
  menuBtn.appendChild(
    lucideIcon(MoreHorizontal, {
      size: 14,
      class: "lucide-icon",
      "stroke-width": 2,
    }),
  );
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openModuleActionsMenu(menuBtn, node, state, callbacks, () => {
      renderModulesList(listContainer, state, callbacks);
    });
  });

  row.append(checkbox, colorDot, icon, name, menuBtn);

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

