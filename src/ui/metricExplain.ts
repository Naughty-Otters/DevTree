/**
 * Floating popup for quality metric definitions (module details + architecture report).
 */
import {
  metricDefinition,
  metricDefinitionText,
  type MetricDefinition,
} from "../analysis/metricDefinitions";
import { t } from "../i18n";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function directionLabel(direction: "lower-better" | "higher-better"): string {
  return direction === "lower-better"
    ? t("metric.direction.lower")
    : t("metric.direction.higher");
}

async function openExternalUrl(url: string): Promise<void> {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    }
  } catch (err) {
    console.warn("opener openUrl failed, falling back", err);
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export interface MetricPopupOptions {
  /** Metric display label (e.g. "Complexity"). */
  label?: string;
  /** Current formatted value shown in the UI. */
  displayValue?: string;
  /** Live measurement note for this row (how this specific value was derived). */
  measuredDetail?: string;
}

let popupEl: HTMLElement | null = null;
let openAnchor: HTMLElement | null = null;
let docClickHandler: ((e: MouseEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
let scrollHandler: (() => void) | null = null;

function ensurePopup(): HTMLElement {
  if (!popupEl || !document.body.contains(popupEl)) {
    popupEl = document.createElement("div");
    popupEl.className = "metric-def-popup hidden";
    popupEl.setAttribute("role", "dialog");
    popupEl.setAttribute("aria-modal", "false");
    popupEl.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(popupEl);
  }
  return popupEl;
}

function clearGlobalListeners(): void {
  if (docClickHandler) {
    document.removeEventListener("mousedown", docClickHandler, true);
    docClickHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
  if (scrollHandler) {
    window.removeEventListener("scroll", scrollHandler, true);
    scrollHandler = null;
  }
}

export function hideMetricDefinitionPopup(): void {
  const popup = popupEl;
  if (popup) popup.classList.add("hidden");
  if (openAnchor) {
    openAnchor.setAttribute("aria-expanded", "false");
    openAnchor.classList.remove("is-def-open");
    openAnchor = null;
  }
  clearGlobalListeners();
}

function positionPopup(popup: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  // Measure while visible.
  popup.style.left = "0px";
  popup.style.top = "0px";
  const tip = popup.getBoundingClientRect();

  let left = rect.left;
  let top = rect.bottom + margin;

  if (left + tip.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - tip.width - margin);
  }
  if (top + tip.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - tip.height - margin);
  }
  left = Math.max(margin, left);

  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
}

function renderPopupContent(
  popup: HTMLElement,
  def: MetricDefinition,
  opts: MetricPopupOptions,
): void {
  const title = opts.label?.trim() || def.id;
  popup.innerHTML = "";
  popup.setAttribute("aria-label", title);

  const header = document.createElement("div");
  header.className = "metric-def-popup-header";

  const titleEl = document.createElement("div");
  titleEl.className = "metric-def-popup-title";
  titleEl.textContent = title;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "metric-def-popup-close";
  closeBtn.setAttribute("aria-label", t("details.close"));
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => hideMetricDefinitionPopup());

  header.append(titleEl, closeBtn);

  const body = document.createElement("div");
  body.className = "metric-def-popup-body";

  const summary = document.createElement("p");
  summary.className = "metric-def-summary";
  summary.textContent = metricDefinitionText(def, "summary");

  const about = document.createElement("p");
  about.className = "metric-def-body";
  about.textContent = metricDefinitionText(def, "body");

  const formulaBlock = document.createElement("div");
  formulaBlock.className = "metric-def-formula-block";
  const formulaLabel = document.createElement("div");
  formulaLabel.className = "metric-def-section-label";
  formulaLabel.textContent = t("metric.formula");
  const formula = document.createElement("code");
  formula.className = "metric-def-formula";
  formula.textContent = metricDefinitionText(def, "formula");
  formulaBlock.append(formulaLabel, formula);

  const meta = document.createElement("div");
  meta.className = "metric-def-meta";
  meta.innerHTML = `<span class="metric-def-direction">${escapeHtml(directionLabel(def.direction))}</span>`;

  body.append(summary, about, formulaBlock, meta);

  if (opts.displayValue?.trim()) {
    const valueRow = document.createElement("div");
    valueRow.className = "metric-def-value-row";
    valueRow.innerHTML = `<span class="metric-def-section-label">${escapeHtml(t("metric.currentValue"))}</span> <span class="metric-def-value">${escapeHtml(opts.displayValue)}</span>`;
    body.appendChild(valueRow);
  }

  if (opts.measuredDetail?.trim()) {
    const measured = document.createElement("p");
    measured.className = "metric-def-measured";
    measured.innerHTML = `<span class="metric-def-section-label">${escapeHtml(t("metric.howMeasured"))}</span> ${escapeHtml(opts.measuredDetail)}`;
    body.appendChild(measured);
  }

  if (def.learnMoreUrl) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "metric-def-link";
    link.textContent = t("metric.learnMore");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openExternalUrl(def.learnMoreUrl!);
    });
    body.appendChild(link);
  }

  popup.append(header, body);
}

/** Show (or toggle) the metric definition popup anchored to `anchor`. */
export function showMetricDefinitionPopup(
  anchor: HTMLElement,
  metricId: string,
  opts: MetricPopupOptions = {},
): boolean {
  const def = metricDefinition(metricId);
  if (!def) return false;

  const popup = ensurePopup();

  // Toggle closed if the same anchor is already open.
  if (openAnchor === anchor && !popup.classList.contains("hidden")) {
    hideMetricDefinitionPopup();
    return true;
  }

  hideMetricDefinitionPopup();
  renderPopupContent(popup, def, opts);
  popup.classList.remove("hidden");
  openAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  anchor.classList.add("is-def-open");
  positionPopup(popup, anchor);

  docClickHandler = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target) return;
    if (popup.contains(target) || anchor.contains(target)) return;
    hideMetricDefinitionPopup();
  };
  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") hideMetricDefinitionPopup();
  };
  scrollHandler = () => {
    if (openAnchor) positionPopup(popup, openAnchor);
  };

  // Defer so the opening click does not immediately close.
  setTimeout(() => {
    if (docClickHandler) {
      document.addEventListener("mousedown", docClickHandler, true);
    }
  }, 0);
  document.addEventListener("keydown", escapeHandler);
  window.addEventListener("scroll", scrollHandler, true);
  return true;
}

/**
 * Make a metric row/card open the definition popup on click / Enter / Space.
 */
export function attachMetricDefinitionToggle(
  row: HTMLElement,
  metricId: string,
  opts: MetricPopupOptions & {
    /** @deprecated unused — popup mounts on document.body */
    listRoot?: HTMLElement;
    panelHost?: HTMLElement;
  },
): void {
  if (!metricDefinition(metricId)) return;

  row.classList.add("metric-has-def");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-expanded", "false");
  row.setAttribute("aria-haspopup", "dialog");
  const tip = row.getAttribute("title");
  row.setAttribute(
    "title",
    tip ? `${tip} — ${t("metric.clickForDef")}` : t("metric.clickForDef"),
  );

  const open = () => {
    showMetricDefinitionPopup(row, metricId, {
      label: opts.label,
      displayValue: opts.displayValue,
      measuredDetail: opts.measuredDetail,
    });
  };

  row.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("a, button, input, select")) return;
    e.preventDefault();
    open();
  });
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
}

/** Affordance mark next to a metric label. */
export function metricInfoAffordance(): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "metric-info-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "ⓘ";
  mark.title = t("metric.clickForDef");
  return mark;
}

/** @deprecated use showMetricDefinitionPopup — kept for tests that imported the old name. */
export function createMetricDefinitionPanel(
  metricId: string,
  measuredDetail?: string,
): HTMLElement | null {
  const def = metricDefinition(metricId);
  if (!def) return null;
  const panel = document.createElement("div");
  panel.className = "metric-def-panel";
  renderPopupContent(panel, def, { measuredDetail });
  return panel;
}
