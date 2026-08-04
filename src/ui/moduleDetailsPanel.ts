import {
  computeQualityReport,
  healthLabel,
  type ChurnMap,
  type MetricScore,
  type QualityReport,
} from "../analysis/codeQualityMetrics";
import {
  ratingBand,
  ratingForQualityPath,
} from "../analysis/architectureHealth";
import {
  formatMetricHint,
  formatMetricPrimary,
  formatPercentilesView,
  parsePercentileViewMode,
  percentileViewLabel,
  PERCENTILE_VIEW_MODES,
  type PercentileViewMode,
} from "../analysis/percentileView";
import { qualityReportFromIndex } from "../analysis/qualityIndex";
import type { AnalysisResult, HierarchyIndex } from "../analysis/types";
import { nodeColor } from "../canvas/colors";
import { createNodeKindShape, nodeKindLabel } from "../canvas/nodeIcons";
import {
  drillIntoPackage,
  graphForNavigation,
  isDrillableNode,
  type GraphNavigation,
} from "../graph/navigation";
import { openableSourceForNode } from "../graph/openSource";
import type { GraphEdge, GraphNode } from "../graph/types";
import { t } from "../i18n";
import { lucideIcon } from "./icons";
import { relatedModules } from "./graphPopup";
import { createLoadingPlaceholder } from "./loadingPlaceholder";
import { appendPagedItems } from "./pagedList";
import { X } from "lucide";

export interface ModuleDetailsHandlers {
  onSelectRelated?: (nodeId: string) => void;
  onOpenContent?: (nodeId: string) => void;
  /** Open a file (or symbol location) in the file viewer. */
  onOpenSource?: (path: string, line?: number) => void;
  onDrillInto?: (nodeId: string) => void;
  onClose?: () => void;
  getPercentileView?: () => PercentileViewMode;
  onPercentileViewChange?: (mode: PercentileViewMode) => void;
}

export interface ModuleDetailsData {
  node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hierarchy: HierarchyIndex | null;
  navigation: GraphNavigation;
  analysis?: AnalysisResult | null;
  churn?: ChurnMap | null;
  /** Per-file quality is still loading from cache. */
  qualityLoading?: boolean;
}

export interface ModuleDetailsPanelApi {
  show: (data: ModuleDetailsData) => void;
  /** Patch churn / quality-loading from the project-wide cache. */
  updateQuality: (patch: {
    churn?: ChurnMap | null;
    qualityLoading?: boolean;
  }) => void;
  hide: () => void;
  /** Re-render the open panel (e.g. after locale change). */
  refresh: () => void;
  isOpen: () => boolean;
  currentNodeId: () => string | null;
}

/** Children / symbols contained by a package or file module. */
export function moduleContents(
  node: GraphNode,
  hierarchy: HierarchyIndex | null,
  navigation: GraphNavigation,
): GraphNode[] {
  if (!hierarchy) return [];

  const kind = node.kind || "";
  if (kind === "package" || kind === "folder") {
    const next = drillIntoPackage(navigation, node.id, node.label);
    return [...graphForNavigation(hierarchy, next).nodes].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  if (kind === "file" || kind === "module") {
    const symbols =
      hierarchy.symbols[node.id] ?? hierarchy.symbols[node.path] ?? [];
    return symbols
      .map(
        (s): GraphNode => ({
          id: s.id,
          label: s.label,
          path: s.file,
          loc: 1,
          kind: s.kind,
          line: s.line,
        }),
      )
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return [];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function appendMetaRow(
  meta: HTMLElement,
  label: string,
  value: string,
  opts?: { title?: string; valueHtml?: string },
): void {
  const row = document.createElement("div");
  row.className = "module-details-row";

  const labelEl = document.createElement("span");
  labelEl.className = "module-details-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "module-details-value";
  if (opts?.title) valueEl.title = opts.title;
  if (opts?.valueHtml) valueEl.innerHTML = opts.valueHtml;
  else valueEl.textContent = value;

  row.append(labelEl, valueEl);
  meta.appendChild(row);
}

function healthBadgeHtml(health: MetricScore["health"]): string {
  return `<span class="module-details-health module-details-health-${health}">${escapeHtml(healthLabel(health))}</span>`;
}

function renderMetricRow(
  metric: MetricScore,
  isPackage: boolean,
  percentileView: PercentileViewMode,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "module-details-metric";
  row.title = metric.detail;

  const label = document.createElement("div");
  label.className = "module-details-metric-label";
  const viewSuffix =
    isPackage &&
    metric.percentiles &&
    percentileView !== "avg" &&
    percentileView !== "all"
      ? ` · ${percentileView}`
      : "";
  label.textContent = `${metric.label}${viewSuffix}`;

  const value = document.createElement("div");
  value.className = "module-details-metric-value";
  const digits = metric.unit === "/kLOC" ? 1 : 0;
  const asPercent = metric.id === "coverage";
  const unit = metric.unit
    ? ` <span class="module-details-churn-unit">${escapeHtml(metric.unit)}</span>`
    : "";

  let primary = metric.display;
  if (isPackage && metric.percentiles && metric.value != null) {
    primary = formatMetricPrimary(
      metric.value,
      metric.percentiles,
      percentileView,
      digits,
      asPercent,
    );
  }

  value.innerHTML = `${escapeHtml(primary)}${unit} ${healthBadgeHtml(metric.health)}`;
  row.append(label, value);

  if (isPackage && metric.percentiles && metric.value != null) {
    const pct = document.createElement("div");
    pct.className = "module-details-metric-percentiles";
    if (percentileView === "avg") {
      pct.textContent = formatPercentilesView(
        metric.percentiles,
        "avg",
        digits,
      );
    } else {
      const hint = formatMetricHint(
        metric.value,
        metric.percentiles,
        percentileView,
        digits,
      );
      if (!hint) return row;
      pct.textContent = hint;
    }
    row.appendChild(pct);
  }

  return row;
}

function renderPercentileViewSwitch(
  mode: PercentileViewMode,
  onChange: (mode: PercentileViewMode) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "percentile-view-switch";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", t("details.percentileView"));

  for (const option of PERCENTILE_VIEW_MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "percentile-view-btn";
    btn.classList.toggle("active", option === mode);
    btn.textContent = percentileViewLabel(option);
    btn.addEventListener("click", () => {
      if (option !== mode) onChange(option);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function renderQualitySection(
  report: QualityReport | null,
  percentileView: PercentileViewMode,
  onPercentileViewChange?: (mode: PercentileViewMode) => void,
  qualityLoading = false,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "module-details-section module-details-quality";
  section.dataset.qualitySection = "1";

  const titleRow = document.createElement("div");
  titleRow.className = "module-details-section-title-row";

  const title = document.createElement("h3");
  title.className = "module-details-section-title";
  title.innerHTML = `${escapeHtml(t("details.qualityTitle"))} <span class="module-details-count">${escapeHtml(t("details.qualitySubtitle"))}</span>`;
  titleRow.appendChild(title);

  if (report?.kind === "package" && onPercentileViewChange) {
    titleRow.appendChild(
      renderPercentileViewSwitch(percentileView, onPercentileViewChange),
    );
  }
  section.appendChild(titleRow);

  if (qualityLoading && !report) {
    const loading = createLoadingPlaceholder({
      title: t("details.qualityLoading"),
      detail: t("details.qualityLoadingDetail"),
      size: "panel",
    });
    loading.classList.add("module-details-loading");
    section.appendChild(loading);
    return section;
  }

  if (!report) {
    const empty = document.createElement("div");
    empty.className = "module-details-empty";
    empty.textContent = t("details.qualityEmpty");
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "module-details-metrics";
  for (const metric of report.metrics) {
    list.appendChild(
      renderMetricRow(metric, report.kind === "package", percentileView),
    );
  }
  section.appendChild(list);

  const note = document.createElement("p");
  note.className = "module-details-metrics-note";
  note.textContent =
    report.kind === "package"
      ? t("details.qualityNotePackage")
      : t("details.qualityNoteFile");
  section.appendChild(note);

  return section;
}

export function createModuleDetailsPanel(
  root: HTMLElement,
  handlers: ModuleDetailsHandlers = {},
): ModuleDetailsPanelApi {
  root.classList.add("module-details-panel");
  root.setAttribute("aria-hidden", "true");

  let open = false;
  let currentId: string | null = null;
  let lastData: ModuleDetailsData | null = null;
  let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  function clearEscape(): void {
    if (escapeHandler) {
      document.removeEventListener("keydown", escapeHandler);
      escapeHandler = null;
    }
  }

  function hide(): void {
    if (!open && currentId == null) return;
    open = false;
    currentId = null;
    lastData = null;
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
    clearEscape();
    handlers.onClose?.();
  }

  function renderList(
    items: GraphNode[],
    emptyText: string,
    onItem: (id: string) => void,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "module-details-list-wrap";

    const list = document.createElement("ul");
    list.className = "module-details-list";
    wrap.appendChild(list);

    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "module-details-empty";
      empty.textContent = emptyText;
      list.appendChild(empty);
      return wrap;
    }

    appendPagedItems(
      list,
      items,
      (item) => {
        const li = document.createElement("li");
        li.className = "module-details-item";
        const openable = openableSourceForNode(item);
        li.title = openable
          ? t("details.showOnGraph", { path: openable.path })
          : item.path;

        const dot = document.createElement("span");
        dot.className = "module-details-dot";
        dot.style.background = nodeColor(item.id);

        const kind = createNodeKindShape(item.kind || "symbol", 16);

        const name = document.createElement("span");
        name.className = "module-details-item-name";
        name.textContent = item.label;

        const meta = document.createElement("span");
        meta.className = "module-details-item-meta";
        meta.textContent = nodeKindLabel(item.kind || "symbol");

        li.append(dot, kind, name, meta);
        li.addEventListener("click", () => {
          // Prefer the Graph file node so metrics/details are one click away.
          // Explicit "Open file" on the panel is for source content.
          const openable = openableSourceForNode(item);
          if (openable) {
            handlers.onSelectRelated?.(openable.path);
            return;
          }
          onItem(item.id);
        });
        return li;
      },
      60,
      wrap,
    );

    return wrap;
  }

  function qualityReportFor(data: ModuleDetailsData): QualityReport | null {
    // Prefer precomputed index (O(1)). Fall back only when analysis lacks quality.
    const fromIndex = qualityReportFromIndex(
      data.analysis?.quality,
      data.node,
      data.churn ?? null,
    );
    if (fromIndex) return fromIndex;
    return computeQualityReport(
      data.hierarchy,
      data.node,
      data.analysis ?? null,
      data.churn ?? null,
    );
  }

  function currentPercentileView(): PercentileViewMode {
    return parsePercentileViewMode(handlers.getPercentileView?.() ?? "all");
  }

  function replaceQualitySection(report: QualityReport | null): void {
    const body = root.querySelector(".module-details-body");
    if (!body) return;
    const existing = body.querySelector("[data-quality-section]");
    const next = renderQualitySection(
      report,
      currentPercentileView(),
      (mode) => {
        handlers.onPercentileViewChange?.(mode);
        if (lastData) show(lastData);
        else replaceQualitySection(report);
      },
    );
    if (existing) existing.replaceWith(next);
    else {
      const meta = body.querySelector(".module-details-meta");
      if (meta?.nextSibling) body.insertBefore(next, meta.nextSibling);
      else body.prepend(next);
    }
  }

  function show(data: ModuleDetailsData): void {
    const { node, nodes, edges, hierarchy, navigation } = data;
    const { dependsOn, usedBy } = relatedModules(node.id, nodes, edges);
    const contents = moduleContents(node, hierarchy, navigation);
    const drillable = isDrillableNode(node, navigation);
    const report = qualityReportFor(data);

    root.replaceChildren();

    const header = document.createElement("header");
    header.className = "module-details-header";

    const title = document.createElement("div");
    title.className = "module-details-title";

    const dot = document.createElement("span");
    dot.className = "module-details-dot";
    dot.style.background = nodeColor(node.id);

    const kindIcon = createNodeKindShape(node.kind || "symbol", 18);
    const name = document.createElement("div");
    name.className = "module-details-name-wrap";
    const nameEl = document.createElement("div");
    nameEl.className = "module-details-name";
    nameEl.textContent = node.label;
    const kindEl = document.createElement("div");
    kindEl.className = "module-details-kind";
    kindEl.textContent = nodeKindLabel(node.kind || "module");
    name.append(nameEl, kindEl);

    title.append(dot, kindIcon, name);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn btn-icon btn-ghost module-details-close";
    closeBtn.title = t("details.close");
    closeBtn.setAttribute("aria-label", t("details.closeAria"));
    closeBtn.appendChild(lucideIcon(X, { size: 14, class: "lucide-icon" }));
    closeBtn.addEventListener("click", hide);

    header.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "module-details-body";

    const meta = document.createElement("div");
    meta.className = "module-details-meta";
    const selfOpenable = openableSourceForNode(node);
    if (selfOpenable && handlers.onOpenSource) {
      const pathRow = document.createElement("div");
      pathRow.className = "module-details-row";
      const pathLabel = document.createElement("span");
      pathLabel.className = "module-details-label";
      pathLabel.textContent = t("details.path");
      const pathBtn = document.createElement("button");
      pathBtn.type = "button";
      pathBtn.className = "btn-text module-details-value module-details-path-link";
      pathBtn.textContent = node.path;
      pathBtn.title = t("details.openPath", { path: selfOpenable.path });
      pathBtn.addEventListener("click", () => {
        handlers.onOpenSource?.(selfOpenable.path, selfOpenable.line);
      });
      pathRow.append(pathLabel, pathBtn);
      meta.appendChild(pathRow);
    } else {
      appendMetaRow(meta, t("details.path"), node.path, { title: node.path });
    }
    if (report?.kind === "package") {
      appendMetaRow(meta, t("details.files"), formatInt(report.fileCount));
    } else if (node.line && node.line > 0) {
      appendMetaRow(meta, t("details.line"), formatInt(node.line));
    } else {
      appendMetaRow(meta, t("details.lines"), formatInt(node.loc));
    }

    const rating = ratingForQualityPath(
      data.analysis?.quality,
      node.path,
      currentPercentileView(),
    );
    if (rating != null) {
      const band = ratingBand(rating);
      appendMetaRow(meta, t("details.rating"), "", {
        title: t("details.ratingTitle"),
        valueHtml: `<span class="module-details-health module-details-health-${band}">${rating}/100</span>`,
      });
    }
    body.appendChild(meta);
    body.appendChild(
      renderQualitySection(
        report,
        currentPercentileView(),
        (mode) => {
          handlers.onPercentileViewChange?.(mode);
          if (lastData) show({ ...lastData });
          else replaceQualitySection(report);
        },
        Boolean(data.qualityLoading),
      ),
    );

    const actions = document.createElement("div");
    actions.className = "module-details-actions";
    if (selfOpenable && handlers.onOpenSource) {
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn btn-ghost module-details-open-file";
      openBtn.textContent =
        selfOpenable.line != null
          ? t("details.openAtLine")
          : t("details.openFile");
      openBtn.addEventListener("click", () => {
        handlers.onOpenSource?.(selfOpenable.path, selfOpenable.line);
      });
      actions.appendChild(openBtn);
    }
    if (drillable) {
      const drill = document.createElement("button");
      drill.type = "button";
      drill.className = "btn btn-ghost module-details-drill";
      drill.textContent =
        node.kind === "file" || node.kind === "module"
          ? t("details.openSymbols")
          : t("details.openContents");
      drill.addEventListener("click", () => handlers.onDrillInto?.(node.id));
      actions.appendChild(drill);
    }
    if (actions.childElementCount > 0) body.appendChild(actions);

    const depsSection = document.createElement("section");
    depsSection.className = "module-details-section";
    depsSection.innerHTML = `<h3 class="module-details-section-title">${escapeHtml(t("details.dependsOn"))} <span class="module-details-count">${dependsOn.length}</span></h3>`;
    depsSection.appendChild(
      renderList(dependsOn, t("details.noOutgoing"), (id) =>
        handlers.onSelectRelated?.(id),
      ),
    );

    const usedSection = document.createElement("section");
    usedSection.className = "module-details-section";
    usedSection.innerHTML = `<h3 class="module-details-section-title">${escapeHtml(t("details.usedBy"))} <span class="module-details-count">${usedBy.length}</span></h3>`;
    usedSection.appendChild(
      renderList(usedBy, t("details.noIncoming"), (id) =>
        handlers.onSelectRelated?.(id),
      ),
    );

    const contentsSection = document.createElement("section");
    contentsSection.className = "module-details-section";
    const contentsTitle =
      node.kind === "file" || node.kind === "module"
        ? t("details.symbols")
        : t("details.contents");
    contentsSection.innerHTML = `<h3 class="module-details-section-title">${escapeHtml(contentsTitle)} <span class="module-details-count">${contents.length}</span></h3>`;
    contentsSection.appendChild(
      renderList(
        contents,
        hierarchy
          ? t("details.nothingInside")
          : t("details.runForContents"),
        (id) => handlers.onOpenContent?.(id),
      ),
    );

    body.append(depsSection, usedSection, contentsSection);
    root.append(header, body);

    lastData = { ...data };
    currentId = node.id;
    open = true;
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");

    clearEscape();
    escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", escapeHandler);

    void root.offsetWidth;
  }

  function updateQuality(patch: {
    churn?: ChurnMap | null;
    qualityLoading?: boolean;
  }): void {
    if (!lastData || !open) return;
    lastData = {
      ...lastData,
      churn: patch.churn !== undefined ? patch.churn : lastData.churn,
      qualityLoading:
        patch.qualityLoading !== undefined
          ? patch.qualityLoading
          : lastData.qualityLoading,
    };
    // Full refresh so rating (percentile-aware) stays in sync with the view switcher.
    show(lastData);
  }

  return {
    show,
    updateQuality,
    hide,
    refresh() {
      if (open && lastData) show(lastData);
    },
    isOpen: () => open,
    currentNodeId: () => currentId,
  };
}
