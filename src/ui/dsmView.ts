import type { HierarchyIndex } from "../analysis/types";
import {
  computeDsm,
  DSM_MAX_ELEMENTS,
  healthStatus,
  type DsmOptions,
  type DsmResult,
} from "../analysis/dsm";
import type { GraphNavigation } from "../graph/navigation";
import { t } from "../i18n";
import { createLoadingPlaceholder } from "./loadingPlaceholder";

export interface DsmViewHandlers {
  onOptionsChange?: (opts: DsmOptions) => void;
  onSelectCell?: (rowId: string, colId: string) => void;
  onSelectElement?: (id: string) => void;
  onShowOnGraph?: () => void;
}

export interface DsmViewState {
  level: "package" | "file";
  ordering: "partitioned" | "hierarchical";
  highlightIds?: Set<string>;
}

function scopeFromNavigation(nav: GraphNavigation): string | null {
  for (let i = nav.crumbs.length - 1; i >= 0; i--) {
    const c = nav.crumbs[i]!;
    if (c.level === "package") return c.id;
  }
  return null;
}

/** Package-level DSM follows graph navigation into folders; root uses "." / sole package. */
function packageScopeFromNavigation(nav: GraphNavigation): string | null {
  return scopeFromNavigation(nav);
}

export function createDsmView(
  container: HTMLElement,
  handlers: DsmViewHandlers = {},
): {
  setData: (
    hierarchy: HierarchyIndex | null,
    navigation: GraphNavigation,
    state: DsmViewState,
    preferred?: DsmResult | null,
  ) => void;
  setLoading: (message: string | null) => void;
  getOptions: () => DsmOptions;
  highlight: (ids: string[]) => void;
} {
  let current: DsmResult | null = null;
  let loadingMessage: string | null = null;
  let viewState: DsmViewState = {
    level: "package",
    ordering: "partitioned",
  };
  let highlightIds = new Set<string>();
  let lastHierarchy: HierarchyIndex | null = null;
  let lastNav: GraphNavigation | null = null;

  container.classList.add("dsm-view");
  container.replaceChildren();

  const toolbar = document.createElement("div");
  toolbar.className = "dsm-toolbar";

  const levelLabel = document.createElement("label");
  levelLabel.className = "dsm-toolbar-field";
  const levelSpan = document.createElement("span");
  levelSpan.textContent = t("dsm.level");
  const levelSelect = document.createElement("select");
  const optPackage = document.createElement("option");
  optPackage.value = "package";
  optPackage.textContent = t("dsm.packages");
  const optFile = document.createElement("option");
  optFile.value = "file";
  optFile.textContent = t("dsm.files");
  levelSelect.append(optPackage, optFile);
  levelLabel.append(levelSpan, levelSelect);

  const orderLabel = document.createElement("label");
  orderLabel.className = "dsm-toolbar-field";
  const orderSpan = document.createElement("span");
  orderSpan.textContent = t("dsm.order");
  const orderSelect = document.createElement("select");
  const optPartitioned = document.createElement("option");
  optPartitioned.value = "partitioned";
  optPartitioned.textContent = t("dsm.partitioned");
  const optHierarchical = document.createElement("option");
  optHierarchical.value = "hierarchical";
  optHierarchical.textContent = t("dsm.hierarchical");
  orderSelect.append(optPartitioned, optHierarchical);
  orderLabel.append(orderSpan, orderSelect);

  const scopeHint = document.createElement("span");
  scopeHint.className = "dsm-scope-hint";

  const healthBadge = document.createElement("span");
  healthBadge.className = "dsm-health-badge";

  const showGraphBtn = document.createElement("button");
  showGraphBtn.type = "button";
  showGraphBtn.className = "btn btn-ghost dsm-show-graph";
  showGraphBtn.textContent = t("dsm.showGraph");
  showGraphBtn.addEventListener("click", () => handlers.onShowOnGraph?.());

  toolbar.append(levelLabel, orderLabel, scopeHint, healthBadge, showGraphBtn);

  const scroll = document.createElement("div");
  scroll.className = "dsm-scroll";

  const empty = document.createElement("div");
  empty.className = "panel-empty dsm-empty";
  empty.textContent = t("dsm.runHint");

  container.append(toolbar, scroll, empty);

  function currentOptions(): DsmOptions {
    const navScope = lastNav ? scopeFromNavigation(lastNav) : null;
    const scope =
      viewState.level === "file"
        ? navScope
        : packageScopeFromNavigation(lastNav ?? { crumbs: [], history: [], historyIndex: 0 });
    return {
      level: viewState.level,
      scope,
      ordering: viewState.ordering,
    };
  }

  function recompute(): void {
    if (!lastHierarchy) {
      current = null;
      render();
      return;
    }
    const opts = currentOptions();
    // Prefer analysis-time package DSM when options match
    current = computeDsm(lastHierarchy, opts);
    render();
  }

  function render(): void {
    levelSelect.value = viewState.level;
    orderSelect.value = viewState.ordering;

    if (loadingMessage) {
      scroll.hidden = true;
      empty.hidden = false;
      empty.replaceChildren(
        createLoadingPlaceholder({
          title: loadingMessage,
          detail: t("dsm.buildingDetail"),
          size: "fill",
        }),
      );
      empty.classList.add("dsm-loading");
      healthBadge.textContent = "";
      healthBadge.className = "dsm-health-badge";
      scopeHint.textContent = "";
      return;
    }
    empty.classList.remove("dsm-loading");

    if (!current || current.elements.length === 0) {
      scroll.hidden = true;
      empty.hidden = false;
      empty.replaceChildren();
      empty.textContent = lastHierarchy
        ? t("dsm.noModulesInScope")
        : t("dsm.runHint");
      healthBadge.textContent = "";
      healthBadge.className = "dsm-health-badge";
      scopeHint.textContent = "";
      return;
    }

    empty.hidden = true;
    empty.replaceChildren();
    scroll.hidden = false;

    const scope = current.scope;
    if (current.level === "file") {
      scopeHint.textContent = scope
        ? t("dsm.scope", { scope })
        : t("dsm.scopeAllFiles");
    } else if (scope) {
      scopeHint.textContent =
        scope === "."
          ? t("dsm.scopeRoot")
          : t("dsm.scopeUnder", { scope });
    } else {
      scopeHint.textContent = t("dsm.scopeWorkspace");
    }
    if (current.capped) {
      scopeHint.textContent += t("dsm.cappedSuffix", { n: DSM_MAX_ELEMENTS });
      scopeHint.title = t("dsm.cappedTitle", { n: DSM_MAX_ELEMENTS });
    } else {
      scopeHint.title = "";
    }

    const score = Math.round(current.metrics.healthScore);
    const status = healthStatus(current.metrics.healthScore);
    healthBadge.textContent = t("dsm.health", { score });
    healthBadge.className = `dsm-health-badge dsm-health-${status}`;
    healthBadge.title = [
      t("dsm.metric.cycles", { n: current.metrics.cycleCount }),
      t("dsm.metric.nodesInCycles", { n: current.metrics.nodesInCycles }),
      t("dsm.metric.upperTriangle", {
        pct: (current.metrics.upperTriangleDensity * 100).toFixed(1),
      }),
      t("dsm.metric.coupling", {
        pct: (current.metrics.couplingDensity * 100).toFixed(1),
      }),
      t("dsm.metric.propagation", {
        pct: (current.metrics.propagationCost * 100).toFixed(1),
      }),
      t("dsm.metric.clusteredCost", {
        pct: ((current.metrics.clusteredCostNormalized ?? 0) * 100).toFixed(1),
      }),
      t("dsm.metric.buses", {
        n: current.metrics.busCount ?? current.busIds?.length ?? 0,
      }),
    ].join("\n");

    const cycleSet = new Set(current.cycleNodes);
    const n = current.elements.length;
    const table = document.createElement("table");
    table.className = "dsm-matrix";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "dsm-corner";
    corner.textContent = "";
    headRow.appendChild(corner);
    for (let j = 0; j < n; j++) {
      const th = document.createElement("th");
      th.className = "dsm-col-header";
      const el = current.elements[j]!;
      th.textContent = String(j + 1);
      th.title = el.id;
      if (highlightIds.has(el.id) || cycleSet.has(el.id)) {
        th.classList.add(cycleSet.has(el.id) ? "dsm-cycle" : "dsm-highlight");
      }
      th.addEventListener("click", () => handlers.onSelectElement?.(el.id));
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let i = 0; i < n; i++) {
      const row = document.createElement("tr");
      const rowEl = current.elements[i]!;
      const th = document.createElement("th");
      th.className = "dsm-row-header";
      th.textContent = `${i + 1}. ${rowEl.label}`;
      th.title = rowEl.id;
      if (highlightIds.has(rowEl.id) || cycleSet.has(rowEl.id)) {
        th.classList.add(cycleSet.has(rowEl.id) ? "dsm-cycle" : "dsm-highlight");
      }
      th.addEventListener("click", () => handlers.onSelectElement?.(rowEl.id));
      row.appendChild(th);

      for (let j = 0; j < n; j++) {
        const td = document.createElement("td");
        const w = current.matrix[i]![j] ?? 0;
        const colEl = current.elements[j]!;
        td.className = "dsm-cell";
        if (i === j) {
          td.classList.add("dsm-diag");
        } else if (w > 0) {
          const mutual = (current.matrix[j]![i] ?? 0) > 0;
          const inCycle =
            cycleSet.has(rowEl.id) && cycleSet.has(colEl.id) && mutual;
          td.classList.add(inCycle || mutual ? "dsm-cell-mutual" : "dsm-cell-dep");
          if (i < j) td.classList.add("dsm-cell-upper");
          const violates = (current.violations ?? []).some(
            (v) =>
              (v.from === rowEl.id && v.to === colEl.id) ||
              (v.from.endsWith(rowEl.id) && v.to.endsWith(colEl.id)),
          );
          if (violates) td.classList.add("dsm-cell-violation");
          const intensity = Math.min(1, 0.35 + w * 0.25);
          td.style.setProperty("--dsm-intensity", String(intensity));
          td.textContent = w > 1 ? String(w) : "·";
          td.title = `${rowEl.id} → ${colEl.id} (${w})`;
          td.addEventListener("click", () => {
            handlers.onSelectCell?.(rowEl.id, colEl.id);
          });
        }
        if (highlightIds.has(rowEl.id) || highlightIds.has(colEl.id)) {
          td.classList.add("dsm-cell-hl");
        }
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);

    scroll.replaceChildren(table);
  }

  levelSelect.addEventListener("change", () => {
    viewState = {
      ...viewState,
      level: levelSelect.value === "file" ? "file" : "package",
    };
    handlers.onOptionsChange?.(currentOptions());
    recompute();
  });

  orderSelect.addEventListener("change", () => {
    viewState = {
      ...viewState,
      ordering:
        orderSelect.value === "hierarchical" ? "hierarchical" : "partitioned",
    };
    handlers.onOptionsChange?.(currentOptions());
    recompute();
  });

  return {
    setLoading(message: string | null) {
      loadingMessage = message;
      render();
    },
    setData(hierarchy, navigation, state, preferred) {
      loadingMessage = null;
      lastHierarchy = hierarchy;
      lastNav = navigation;
      viewState = { ...state };
      highlightIds = state.highlightIds ?? new Set();

      const opts = currentOptions();
      const normalizedOptScope =
        opts.level === "file"
          ? (opts.scope ?? null)
          : (opts.scope ??
            lastHierarchy?.packages[0] ??
            (lastHierarchy && lastHierarchy.packages.length > 1 ? null : "."));
      const normalizedPrefScope =
        preferred?.level === "file"
          ? (preferred.scope ?? null)
          : (preferred?.scope ??
            lastHierarchy?.packages[0] ??
            (lastHierarchy && lastHierarchy.packages.length > 1 ? null : "."));

      const canUsePreferred =
        preferred &&
        preferred.level === opts.level &&
        normalizedPrefScope === normalizedOptScope &&
        preferred.ordering === opts.ordering &&
        preferred.elements.length > 0;

      current =
        canUsePreferred && preferred
          ? preferred
          : hierarchy
            ? computeDsm(hierarchy, opts)
            : null;
      render();
    },
    getOptions: currentOptions,
    highlight(ids) {
      highlightIds = new Set(ids);
      render();
    },
  };
}
