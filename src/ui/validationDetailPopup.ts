import type { CycleGroup, ValidationItem } from "../analysis/types";
import type { SymbolInfo } from "../analysis/types";
import {
  groupAffectedByFile,
  type ValidationAffectedEntry,
} from "../validation/parseAffected";
import { cycleGroupsFromValidation, cycleKindLabel } from "../validation/cycles";

export interface ValidationNavTarget {
  file: string;
  line?: number;
  symbolId?: string;
}

export interface ValidationDetailHandlers {
  onOpenFile: (target: ValidationNavTarget) => void;
  onShowOnGraph: (target: ValidationNavTarget) => void;
  onShowCycleOnGraph?: (cycle: CycleGroup) => void;
  resolveSymbol?: (
    file: string,
    line?: number,
  ) => SymbolInfo | undefined;
}

let backdropEl: HTMLElement | null = null;
let dialogEl: HTMLElement | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

function ensureElements(): { backdrop: HTMLElement; dialog: HTMLElement } {
  if (!backdropEl) {
    backdropEl = document.createElement("div");
    backdropEl.className = "validation-detail-backdrop hidden";
    backdropEl.addEventListener("click", (e) => {
      if (e.target === backdropEl) hideValidationDetail();
    });

    dialogEl = document.createElement("div");
    dialogEl.className = "validation-detail-dialog";
    dialogEl.addEventListener("click", (e) => e.stopPropagation());

    backdropEl.appendChild(dialogEl);
    document.body.appendChild(backdropEl);
  }
  return { backdrop: backdropEl!, dialog: dialogEl! };
}


function entryLabel(
  entry: ValidationAffectedEntry,
  symbol?: SymbolInfo,
): string {
  if (symbol) {
    return `${symbol.kind} ${symbol.label}`;
  }
  if (entry.line != null && entry.line > 0) {
    return `Line ${entry.line}`;
  }
  if (entry.message && entry.message !== entry.file) {
    return entry.message;
  }
  return "Issue";
}

function entryDetail(entry: ValidationAffectedEntry, symbol?: SymbolInfo): string {
  const parts: string[] = [];
  if (entry.line != null && entry.line > 0) {
    parts.push(`line ${entry.line}`);
  }
  if (symbol) {
    parts.push(symbol.kind);
  }
  if (entry.severity) {
    parts.push(entry.severity);
  }
  if (entry.message && entry.message !== symbol?.label) {
    parts.push(entry.message);
  }
  return parts.join(" · ") || entry.raw;
}

export function showValidationDetail(
  item: ValidationItem,
  handlers: ValidationDetailHandlers,
): void {
  const { backdrop, dialog } = ensureElements();
  const groups = groupAffectedByFile(item.affected);

  const header = document.createElement("div");
  header.className = "validation-detail-header";

  const titleRow = document.createElement("div");
  titleRow.className = "validation-detail-title-row";

  const badge = document.createElement("span");
  badge.className = `validation-badge badge-${item.status}`;
  badge.textContent = item.status.toUpperCase();

  const title = document.createElement("h2");
  title.className = "validation-detail-title";
  title.textContent = item.rule_name;

  titleRow.append(badge, title);

  const message = document.createElement("p");
  message.className = "validation-detail-message";
  message.textContent = item.message;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "validation-detail-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => hideValidationDetail());

  header.append(titleRow, message, closeBtn);

  const body = document.createElement("div");
  body.className = "validation-detail-body scrollable";

  const cycles = cycleGroupsFromValidation(item);
  if (cycles.length > 0) {
    const intro = document.createElement("p");
    intro.className = "validation-detail-cycle-intro";
    intro.textContent =
      "Each group is a circular dependency. Use “Show on graph” to highlight the cycle on the dependency diagram.";
    body.appendChild(intro);

    const list = document.createElement("ul");
    list.className = "validation-detail-cycles";

    for (const [, cycle] of cycles.entries()) {
      const li = document.createElement("li");
      li.className = "validation-detail-cycle";

      const header = document.createElement("div");
      header.className = "validation-detail-cycle-header";

      const kind = document.createElement("span");
      kind.className = "validation-detail-cycle-kind";
      kind.textContent = cycleKindLabel(cycle.kind);

      const count = document.createElement("span");
      count.className = "validation-detail-cycle-count";
      count.textContent =
        cycle.node_count != null && cycle.node_count > cycle.nodes.length
          ? `${cycle.node_count} nodes`
          : `${cycle.nodes.length} node${cycle.nodes.length === 1 ? "" : "s"}`;

      header.append(kind, count);

      const label = document.createElement("div");
      label.className = "validation-detail-cycle-label";
      label.textContent = cycle.label;

      const actions = document.createElement("div");
      actions.className = "validation-detail-entry-actions";

      const graphBtn = document.createElement("button");
      graphBtn.type = "button";
      graphBtn.className = "btn-text validation-detail-action";
      graphBtn.textContent = "Show on graph";
      graphBtn.addEventListener("click", () => {
        handlers.onShowCycleOnGraph?.(cycle);
      });

      actions.append(graphBtn);
      li.append(header, label, actions);
      list.appendChild(li);
    }

    body.appendChild(list);
  } else if (groups.size === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No file or symbol details for this rule.";
    body.appendChild(empty);
  } else {
    for (const [file, entries] of groups) {
      const section = document.createElement("section");
      section.className = "validation-detail-file";

      const fileHeader = document.createElement("div");
      fileHeader.className = "validation-detail-file-header";

      const filePath = document.createElement("button");
      filePath.type = "button";
      filePath.className = "validation-detail-file-path";
      filePath.textContent = file;
      filePath.title = "Open file";
      filePath.addEventListener("click", () => {
        handlers.onOpenFile({ file });
      });

      const graphFileBtn = document.createElement("button");
      graphFileBtn.type = "button";
      graphFileBtn.className = "btn-text validation-detail-action";
      graphFileBtn.textContent = "Show file on graph";
      graphFileBtn.addEventListener("click", () => {
        handlers.onShowOnGraph({ file });
      });

      fileHeader.append(filePath, graphFileBtn);
      section.appendChild(fileHeader);

      const list = document.createElement("ul");
      list.className = "validation-detail-entries";

      for (const entry of entries) {
        const symbol =
          entry.line != null && entry.line > 0
            ? handlers.resolveSymbol?.(file, entry.line)
            : undefined;

        const li = document.createElement("li");
        li.className = "validation-detail-entry";

        const main = document.createElement("div");
        main.className = "validation-detail-entry-main";

        const name = document.createElement("span");
        name.className = "validation-detail-entry-label";
        name.textContent = entryLabel(entry, symbol);

        const detail = document.createElement("span");
        detail.className = "validation-detail-entry-detail";
        detail.textContent = entryDetail(entry, symbol);

        main.append(name, detail);

        const actions = document.createElement("div");
        actions.className = "validation-detail-entry-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "btn-text validation-detail-action";
        openBtn.textContent = "Open";
        openBtn.addEventListener("click", () => {
          handlers.onOpenFile({
            file,
            line: entry.line,
            symbolId: symbol?.id,
          });
        });

        const graphBtn = document.createElement("button");
        graphBtn.type = "button";
        graphBtn.className = "btn-text validation-detail-action";
        graphBtn.textContent = symbol ? "Go to symbol" : "Show on graph";
        graphBtn.addEventListener("click", () => {
          handlers.onShowOnGraph({
            file,
            line: entry.line,
            symbolId: symbol?.id,
          });
        });

        actions.append(openBtn, graphBtn);
        li.append(main, actions);
        list.appendChild(li);
      }

      section.appendChild(list);
      body.appendChild(section);
    }
  }

  dialog.replaceChildren(header, body);
  backdrop.classList.remove("hidden");

  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
  }
  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") hideValidationDetail();
  };
  document.addEventListener("keydown", escapeHandler);
}

export function hideValidationDetail(): void {
  backdropEl?.classList.add("hidden");
  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
}

export function isValidationDetailOpen(): boolean {
  return backdropEl != null && !backdropEl.classList.contains("hidden");
}
