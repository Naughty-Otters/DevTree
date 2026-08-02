import type { AnalysisResult, ValidationItem } from "../analysis/types";
import type { GraphEdge, GraphNode } from "../graph/types";
import { cycleGroupsFromValidation } from "../validation/cycles";
import { appendPagedItems } from "./pagedList";
import {
  showValidationDetail,
  type ValidationDetailHandlers,
} from "./validationDetailPopup";

export type AnalysisStatKind =
  | "modules"
  | "dependencies"
  | "pass"
  | "warn"
  | "fail";

export interface AnalysisDetailHandlers {
  onShowModuleOnGraph?: (nodeId: string) => void;
  onShowDependencyOnGraph?: (source: string, target: string) => void;
  validation?: ValidationDetailHandlers;
}

let backdropEl: HTMLElement | null = null;
let dialogEl: HTMLElement | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

const STAT_TITLES: Record<AnalysisStatKind, string> = {
  modules: "Modules",
  dependencies: "Dependencies",
  pass: "Passed rules",
  warn: "Warnings",
  fail: "Failures",
};

function ensureElements(): { backdrop: HTMLElement; dialog: HTMLElement } {
  if (!backdropEl) {
    backdropEl = document.createElement("div");
    backdropEl.className = "validation-detail-backdrop hidden";
    backdropEl.addEventListener("click", (e) => {
      if (e.target === backdropEl) hideAnalysisStatDetail();
    });

    dialogEl = document.createElement("div");
    dialogEl.className = "validation-detail-dialog";
    dialogEl.addEventListener("click", (e) => e.stopPropagation());

    backdropEl.appendChild(dialogEl);
    document.body.appendChild(backdropEl);
  }
  return { backdrop: backdropEl!, dialog: dialogEl! };
}

function sortNodes(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => a.label.localeCompare(b.label));
}

function sortEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...edges].sort((a, b) => {
    const bySource = a.source.localeCompare(b.source);
    if (bySource !== 0) return bySource;
    return a.target.localeCompare(b.target);
  });
}

function validationItemsForKind(
  result: AnalysisResult,
  kind: "pass" | "warn" | "fail",
): ValidationItem[] {
  return result.validation.filter((item) => item.status === kind);
}

function validationHasDetails(item: ValidationItem): boolean {
  return (
    item.affected.length > 0 ||
    cycleGroupsFromValidation(item).length > 0
  );
}

function renderModuleList(
  body: HTMLElement,
  nodes: GraphNode[],
  handlers: AnalysisDetailHandlers,
): void {
  if (nodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No modules in the dependency graph.";
    body.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "validation-detail-entries analysis-detail-entries";
  body.appendChild(list);

  appendPagedItems(
    list,
    sortNodes(nodes),
    (node) => {
      const li = document.createElement("li");
      li.className = "validation-detail-entry";

      const main = document.createElement("div");
      main.className = "validation-detail-entry-main";

      const name = document.createElement("span");
      name.className = "validation-detail-entry-label";
      name.textContent = node.label;

      const detail = document.createElement("span");
      detail.className = "validation-detail-entry-detail";
      detail.textContent = `${node.path} · ${node.loc} LOC · ${node.kind}`;

      main.append(name, detail);

      const actions = document.createElement("div");
      actions.className = "validation-detail-entry-actions";

      const graphBtn = document.createElement("button");
      graphBtn.type = "button";
      graphBtn.className = "btn-text validation-detail-action";
      graphBtn.textContent = "Show on graph";
      graphBtn.addEventListener("click", () => {
        handlers.onShowModuleOnGraph?.(node.id);
      });
      actions.appendChild(graphBtn);

      li.append(main, actions);
      return li;
    },
    80,
    body,
  );
}

function renderDependencyList(
  body: HTMLElement,
  edges: GraphEdge[],
  handlers: AnalysisDetailHandlers,
): void {
  if (edges.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No dependencies in the dependency graph.";
    body.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "validation-detail-entries analysis-detail-entries";
  body.appendChild(list);

  appendPagedItems(
    list,
    sortEdges(edges),
    (edge) => {
      const li = document.createElement("li");
      li.className = "validation-detail-entry";

      const main = document.createElement("div");
      main.className = "validation-detail-entry-main";

      const name = document.createElement("span");
      name.className = "validation-detail-entry-label";
      name.textContent = `${edge.source} → ${edge.target}`;

      const detail = document.createElement("span");
      detail.className = "validation-detail-entry-detail";
      detail.textContent = edge.kind;

      main.append(name, detail);

      const actions = document.createElement("div");
      actions.className = "validation-detail-entry-actions";

      const graphBtn = document.createElement("button");
      graphBtn.type = "button";
      graphBtn.className = "btn-text validation-detail-action";
      graphBtn.textContent = "Show on graph";
      graphBtn.addEventListener("click", () => {
        handlers.onShowDependencyOnGraph?.(edge.source, edge.target);
      });
      actions.appendChild(graphBtn);

      li.append(main, actions);
      return li;
    },
    80,
    body,
  );
}

function renderValidationRuleList(
  body: HTMLElement,
  items: ValidationItem[],
  handlers: AnalysisDetailHandlers,
): void {
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No rules in this category.";
    body.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "validation-detail-entries analysis-detail-entries";

  for (const item of items) {
    const hasDetails = validationHasDetails(item);
    const li = document.createElement("li");
    li.className = "validation-detail-entry";

    const main = document.createElement("div");
    main.className = "validation-detail-entry-main";

    const titleRow = document.createElement("div");
    titleRow.className = "analysis-detail-rule-title";

    const badge = document.createElement("span");
    badge.className = `validation-badge badge-${item.status}`;
    badge.textContent = item.status.toUpperCase();

    const name = document.createElement("span");
    name.className = "validation-detail-entry-label";
    name.textContent = item.rule_name;

    titleRow.append(badge, name);

    const detail = document.createElement("span");
    detail.className = "validation-detail-entry-detail";
    detail.textContent = item.message;

    main.append(titleRow, detail);

    const actions = document.createElement("div");
    actions.className = "validation-detail-entry-actions";

    if (hasDetails && handlers.validation) {
      const detailsBtn = document.createElement("button");
      detailsBtn.type = "button";
      detailsBtn.className = "btn-text validation-detail-action";
      detailsBtn.textContent = "View details";
      detailsBtn.addEventListener("click", () => {
        hideAnalysisStatDetail();
        showValidationDetail(item, handlers.validation!);
      });
      actions.appendChild(detailsBtn);
    }

    li.append(main, actions);
    list.appendChild(li);
  }

  body.appendChild(list);
}

export function showAnalysisStatDetail(
  kind: AnalysisStatKind,
  result: AnalysisResult,
  handlers: AnalysisDetailHandlers = {},
): void {
  const { backdrop, dialog } = ensureElements();

  const header = document.createElement("div");
  header.className = "validation-detail-header";

  const titleRow = document.createElement("div");
  titleRow.className = "validation-detail-title-row";

  const title = document.createElement("h2");
  title.className = "validation-detail-title";
  title.textContent = STAT_TITLES[kind];

  titleRow.appendChild(title);

  const message = document.createElement("p");
  message.className = "validation-detail-message";

  const body = document.createElement("div");
  body.className = "validation-detail-body scrollable";

  switch (kind) {
    case "modules": {
      const count = result.graph.nodes.length;
      message.textContent = `${count} module${count === 1 ? "" : "s"} in the analyzed dependency graph.`;
      renderModuleList(body, result.graph.nodes, handlers);
      break;
    }
    case "dependencies": {
      const count = result.graph.edges.length;
      message.textContent = `${count} dependency edge${count === 1 ? "" : "s"} between modules.`;
      renderDependencyList(body, result.graph.edges, handlers);
      break;
    }
    case "pass":
    case "warn":
    case "fail": {
      const items = validationItemsForKind(result, kind);
      message.textContent = `${items.length} validation rule${items.length === 1 ? "" : "s"} with status “${kind}”.`;
      renderValidationRuleList(body, items, handlers);
      break;
    }
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "validation-detail-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => hideAnalysisStatDetail());

  header.append(titleRow, message, closeBtn);
  dialog.replaceChildren(header, body);
  backdrop.classList.remove("hidden");

  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
  }
  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") hideAnalysisStatDetail();
  };
  document.addEventListener("keydown", escapeHandler);
}

export function hideAnalysisStatDetail(): void {
  backdropEl?.classList.add("hidden");
  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
}

export function isAnalysisStatDetailOpen(): boolean {
  return backdropEl != null && !backdropEl.classList.contains("hidden");
}
