import type { IconNode } from "lucide";
import {
  ArrowDown,
  ArrowRight,
  ChevronRight,
  Circle,
  CornerDownRight,
  Crosshair,
  GitFork,
  Group,
  Minus,
  Share2,
  Spline,
  Target,
  Workflow,
} from "lucide";
import {
  EDGE_STYLES,
  type EdgeStyle,
} from "../canvas/edgeStyle";
import type { GraphNavigation, NavCrumb } from "../graph/navigation";
import {
  MODULE_FILTER_OPTIONS,
  type ModuleFilterFlags,
} from "../graph/moduleFilters";
import {
  LANGUAGE_FILTER_OPTIONS,
  type GraphLanguageId,
  type LanguageFilterFlags,
} from "../graph/languages";
import { t } from "../i18n";
import { lucideIcon } from "./icons";
import {
  DAG_STYLES,
  LAYOUT_FAMILIES,
  dagStyleFromLayoutMode,
  familyFromLayoutMode,
  layoutModeFromFamily,
  type DagStyle,
  type LayoutFamily,
  type LayoutMode,
} from "../wasm-bridge";

export interface GraphNavOptions {
  stats?: { nodes: number; edges: number };
  staleImports?: boolean;
  layoutMode?: LayoutMode;
  edgeStyle?: EdgeStyle;
  moduleFilters?: ModuleFilterFlags;
  languageFilters?: LanguageFilterFlags;
  /** Languages present in the current graph (limits Language menu options). */
  presentLanguages?: GraphLanguageId[];
  /** Enable Focus (relayout visible + fit) in the graph toolbar. */
  focusEnabled?: boolean;
}

export interface GraphNavCallbacks {
  onBack: () => void;
  onForward: () => void;
  onNavigate: (crumb: NavCrumb) => void;
  onLayoutModeChange?: (mode: LayoutMode) => void;
  onEdgeStyleChange?: (style: EdgeStyle) => void;
  onModuleFiltersChange?: (filters: ModuleFilterFlags) => void;
  onLanguageFiltersChange?: (filters: LanguageFilterFlags) => void;
  onFocusView?: () => void;
  /** Shown on the stale-imports warning banner. */
  onRunAnalysis?: () => void;
}

export interface BreadcrumbBarCallbacks {
  onBack: () => void;
  onForward: () => void;
  onNavigate: (crumb: NavCrumb) => void;
}

export interface BreadcrumbBarOptions {
  stats?: { nodes: number; edges: number };
  /** Flat file path for the File view (VS Code-style segments). */
  filePath?: string | null;
  hint?: string | null;
}

/** VS Code-style location bar under the main toolbar. */
export function renderBreadcrumbBar(
  container: HTMLElement,
  nav: GraphNavigation,
  canBack: boolean,
  canForward: boolean,
  callbacks: BreadcrumbBarCallbacks,
  options: BreadcrumbBarOptions = {},
): void {
  container.innerHTML = "";
  container.classList.remove("is-empty");

  const bar = document.createElement("div");
  bar.className = "breadcrumb-bar-inner";

  const history = document.createElement("div");
  history.className = "breadcrumb-history";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "breadcrumb-history-btn";
  backBtn.title = t("graph.back");
  backBtn.setAttribute("aria-label", t("graph.back"));
  backBtn.disabled = !canBack;
  backBtn.textContent = "←";
  backBtn.addEventListener("click", callbacks.onBack);

  const forwardBtn = document.createElement("button");
  forwardBtn.type = "button";
  forwardBtn.className = "breadcrumb-history-btn";
  forwardBtn.title = t("graph.forward");
  forwardBtn.setAttribute("aria-label", t("graph.forward"));
  forwardBtn.disabled = !canForward;
  forwardBtn.textContent = "→";
  forwardBtn.addEventListener("click", callbacks.onForward);

  history.append(backBtn, forwardBtn);

  const crumbs = document.createElement("nav");
  crumbs.className = "breadcrumb-items";
  crumbs.setAttribute("aria-label", t("graph.location"));

  if (options.filePath) {
    appendFilePathCrumbs(crumbs, options.filePath);
  } else {
    nav.crumbs.forEach((crumb, i) => {
      if (i > 0) {
        crumbs.appendChild(breadcrumbSeparator());
      }
      const isLast = i === nav.crumbs.length - 1;
      if (isLast) {
        const current = document.createElement("span");
        current.className = "breadcrumb-item breadcrumb-item-current";
        current.textContent = crumb.label;
        current.title = crumb.label;
        crumbs.appendChild(current);
      } else {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "breadcrumb-item breadcrumb-item-link";
        link.textContent = crumb.label;
        link.title = crumb.label;
        link.addEventListener("click", () => callbacks.onNavigate(crumb));
        crumbs.appendChild(link);
      }
    });
  }

  bar.append(history, crumbs);

  if (options.stats && !options.filePath) {
    const stats = document.createElement("span");
    stats.className = "breadcrumb-stats";
    stats.textContent = t("graph.modulesDeps", {
      modules: options.stats.nodes,
      deps: options.stats.edges,
    });
    bar.appendChild(stats);
  }

  if (options.hint) {
    const hint = document.createElement("span");
    hint.className = "breadcrumb-hint";
    hint.textContent = options.hint;
    hint.title = options.hint;
    bar.appendChild(hint);
  }

  container.appendChild(bar);
}

export function clearBreadcrumbBar(container: HTMLElement): void {
  container.innerHTML = "";
  container.classList.add("is-empty");
}

function breadcrumbSeparator(): HTMLElement {
  const sep = document.createElement("span");
  sep.className = "breadcrumb-sep";
  sep.setAttribute("aria-hidden", "true");
  sep.appendChild(
    lucideIcon(ChevronRight, {
      size: 12,
      class: "lucide-icon breadcrumb-sep-icon",
      "stroke-width": 2,
    }),
  );
  return sep;
}

function appendFilePathCrumbs(crumbs: HTMLElement, filePath: string): void {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) {
    const current = document.createElement("span");
    current.className = "breadcrumb-item breadcrumb-item-current";
    current.textContent = filePath;
    crumbs.appendChild(current);
    return;
  }
  parts.forEach((part, i) => {
    if (i > 0) crumbs.appendChild(breadcrumbSeparator());
    const isLast = i === parts.length - 1;
    const el = document.createElement("span");
    el.className = isLast
      ? "breadcrumb-item breadcrumb-item-current"
      : "breadcrumb-item";
    el.textContent = part;
    el.title = parts.slice(0, i + 1).join("/");
    crumbs.appendChild(el);
  });
}

const LAYOUT_ICONS: Record<LayoutFamily, IconNode> = {
  organic: Share2,
  cluster: Group,
  dag: Workflow,
  circular: Circle,
  radial: Target,
  tree: GitFork,
};

const DAG_ICONS: Record<DagStyle, IconNode> = {
  direct: ArrowRight,
  hierarchical: ArrowDown,
};

const EDGE_ICONS: Record<EdgeStyle, IconNode> = {
  straight: Minus,
  orthogonal: CornerDownRight,
  curved: Spline,
};

const TOOL_ICON = {
  size: 14,
  class: "lucide-icon graph-nav-tool-icon",
  "stroke-width": 1.85,
};

function renderFilterDropdown(
  flags: ModuleFilterFlags,
  onChange: (filters: ModuleFilterFlags) => void,
): HTMLElement {
  const wrap = document.createElement("details");
  wrap.className = "graph-nav-filter";

  const summary = document.createElement("summary");
  summary.className = "graph-nav-filter-summary";
  summary.textContent = t("graph.filter");
  summary.title = t("graph.filterTitle");

  const menu = document.createElement("div");
  menu.className = "graph-nav-filter-menu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", t("graph.moduleFilters"));

  const current = { ...flags };

  for (const opt of MODULE_FILTER_OPTIONS) {
    const row = document.createElement("label");
    row.className = "graph-nav-filter-option";
    row.title = opt.hint;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = current[opt.key];
    input.addEventListener("change", () => {
      current[opt.key] = input.checked;
      onChange({ ...current });
    });

    const text = document.createElement("span");
    text.textContent = opt.label;

    row.append(input, text);
    menu.appendChild(row);
  }

  wrap.append(summary, menu);

  const onDocClick = (e: MouseEvent) => {
    if (!document.body.contains(wrap)) {
      document.removeEventListener("click", onDocClick);
      return;
    }
    if (!wrap.open) return;
    if (e.target instanceof Node && wrap.contains(e.target)) return;
    wrap.open = false;
  };
  wrap.addEventListener("toggle", () => {
    if (wrap.open) {
      requestAnimationFrame(() => document.addEventListener("click", onDocClick));
    } else {
      document.removeEventListener("click", onDocClick);
    }
  });

  return wrap;
}

function renderLanguageFilterDropdown(
  flags: LanguageFilterFlags,
  present: GraphLanguageId[] | undefined,
  onChange: (filters: LanguageFilterFlags) => void,
): HTMLElement {
  const wrap = document.createElement("details");
  wrap.className = "graph-nav-filter graph-nav-language-filter";

  const summary = document.createElement("summary");
  summary.className = "graph-nav-filter-summary";
  summary.textContent = t("graph.language");
  summary.title = t("graph.languageTitle");

  const menu = document.createElement("div");
  menu.className = "graph-nav-filter-menu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", t("graph.languageFilters"));

  const current = { ...flags };
  const options =
    present && present.length > 0
      ? LANGUAGE_FILTER_OPTIONS.filter((opt) => present.includes(opt.key))
      : LANGUAGE_FILTER_OPTIONS;

  if (options.length === 0) {
    const empty = document.createElement("div");
    empty.className = "graph-nav-filter-empty";
    empty.textContent = t("graph.noLanguages");
    menu.appendChild(empty);
  } else {
    for (const opt of options) {
      const row = document.createElement("label");
      row.className = "graph-nav-filter-option";
      row.title = opt.hint;

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = current[opt.key];
      input.addEventListener("change", () => {
        current[opt.key] = input.checked;
        onChange({ ...current });
      });

      const text = document.createElement("span");
      text.textContent = opt.label;

      row.append(input, text);
      menu.appendChild(row);
    }
  }

  wrap.append(summary, menu);

  const onDocClick = (e: MouseEvent) => {
    if (!document.body.contains(wrap)) {
      document.removeEventListener("click", onDocClick);
      return;
    }
    if (!wrap.open) return;
    if (e.target instanceof Node && wrap.contains(e.target)) return;
    wrap.open = false;
  };
  wrap.addEventListener("toggle", () => {
    if (wrap.open) {
      requestAnimationFrame(() => document.addEventListener("click", onDocClick));
    } else {
      document.removeEventListener("click", onDocClick);
    }
  });

  return wrap;
}

function renderIconButtonGroup<T extends string>(opts: {
  label: string;
  ariaLabel: string;
  title?: string;
  items: { value: T; label: string; hint: string; icon: IconNode }[];
  current: T;
  onChange: (value: T) => void;
}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "graph-nav-tool";
  if (opts.title) wrap.title = opts.title;

  const caption = document.createElement("span");
  caption.className = "graph-nav-tool-label";
  caption.textContent = opts.label;

  const group = document.createElement("div");
  group.className = "graph-nav-icon-list";
  group.setAttribute("role", "toolbar");
  group.setAttribute("aria-label", opts.ariaLabel);

  const buttons = new Map<T, HTMLButtonElement>();

  for (const item of opts.items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "graph-nav-icon-btn";
    btn.dataset.value = item.value;
    btn.title = `${item.label} — ${item.hint}`;
    btn.setAttribute("aria-label", item.label);
    btn.setAttribute("aria-pressed", item.value === opts.current ? "true" : "false");
    if (item.value === opts.current) btn.classList.add("is-active");
    btn.appendChild(lucideIcon(item.icon, TOOL_ICON));
    btn.addEventListener("click", () => {
      if (btn.classList.contains("is-active")) return;
      for (const [value, other] of buttons) {
        const active = value === item.value;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", active ? "true" : "false");
      }
      opts.onChange(item.value);
    });
    buttons.set(item.value, btn);
    group.appendChild(btn);
  }

  wrap.append(caption, group);
  return wrap;
}

function renderLayoutControls(
  currentMode: LayoutMode,
  onChange: (mode: LayoutMode) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "graph-nav-layout-group";

  let family = familyFromLayoutMode(currentMode);
  let dagStyle = dagStyleFromLayoutMode(currentMode);

  const familyTool = renderIconButtonGroup<LayoutFamily>({
    label: t("graph.layout"),
    ariaLabel: t("graph.layoutAria"),
    title: t("graph.layoutTitle"),
    items: LAYOUT_FAMILIES.map((mode) => ({
      value: mode.value,
      label: mode.label,
      hint: mode.hint,
      icon: LAYOUT_ICONS[mode.value],
    })),
    current: family,
    onChange: (next) => {
      family = next;
      flowTool.hidden = family !== "dag";
      onChange(layoutModeFromFamily(family, dagStyle));
    },
  });

  const flowTool = renderIconButtonGroup<DagStyle>({
    label: t("graph.flow"),
    ariaLabel: t("graph.flowAria"),
    title: t("graph.flowTitle"),
    items: DAG_STYLES.map((style) => ({
      value: style.value,
      label: style.label,
      hint: style.hint,
      icon: DAG_ICONS[style.value],
    })),
    current: dagStyle,
    onChange: (next) => {
      dagStyle = next;
      onChange(layoutModeFromFamily(family, dagStyle));
    },
  });
  flowTool.classList.add("graph-nav-dag-style");
  flowTool.hidden = family !== "dag";

  wrap.append(familyTool, flowTool);
  return wrap;
}

function renderEdgeStyleControl(
  current: EdgeStyle,
  onChange: (style: EdgeStyle) => void,
): HTMLElement {
  return renderIconButtonGroup<EdgeStyle>({
    label: t("graph.edges"),
    ariaLabel: t("graph.edgesAria"),
    title: t("graph.edgesTitle"),
    items: EDGE_STYLES.map((style) => ({
      value: style.value,
      label: style.label,
      hint: style.hint,
      icon: EDGE_ICONS[style.value],
    })),
    current,
    onChange,
  });
}

export function renderGraphNav(
  container: HTMLElement,
  nav: GraphNavigation,
  canBack: boolean,
  canForward: boolean,
  callbacks: GraphNavCallbacks,
  options: GraphNavOptions = {},
): void {
  container.innerHTML = "";

  const stack = document.createElement("div");
  stack.className = "graph-nav-stack";

  const toolsBar = document.createElement("div");
  toolsBar.className = "graph-nav-bar";

  const layoutControls = renderLayoutControls(
    options.layoutMode ?? "organic",
    (mode) => callbacks.onLayoutModeChange?.(mode),
  );

  const edgeStyleControl = renderEdgeStyleControl(
    options.edgeStyle ?? "straight",
    (style) => callbacks.onEdgeStyleChange?.(style),
  );

  const filterFlags = options.moduleFilters ?? {
    withDependencies: true,
    independent: true,
    circular: true,
    hub: true,
  };
  const filterDropdown = renderFilterDropdown(filterFlags, (next) => {
    callbacks.onModuleFiltersChange?.(next);
  });

  const languageFlags = options.languageFilters ?? {
    typescript: true,
    rust: true,
    python: true,
    go: true,
    java: true,
    other: true,
  };
  const languageDropdown = renderLanguageFilterDropdown(
    languageFlags,
    options.presentLanguages,
    (next) => {
      callbacks.onLanguageFiltersChange?.(next);
    },
  );

  const focusTool = document.createElement("div");
  focusTool.className = "graph-nav-tool";
  const focusLabel = document.createElement("span");
  focusLabel.className = "graph-nav-tool-label";
  focusLabel.textContent = t("graph.view");
  const focusList = document.createElement("div");
  focusList.className = "graph-nav-icon-list";
  focusList.setAttribute("aria-label", t("graph.viewAria"));
  const focusBtn = document.createElement("button");
  focusBtn.type = "button";
  focusBtn.className = "graph-nav-icon-btn";
  focusBtn.setAttribute("aria-label", t("graph.focus"));
  focusBtn.title = t("graph.focusTitle");
  focusBtn.disabled = options.focusEnabled === false;
  focusBtn.appendChild(lucideIcon(Crosshair, TOOL_ICON));
  focusBtn.addEventListener("click", () => callbacks.onFocusView?.());
  focusList.appendChild(focusBtn);
  focusTool.append(focusLabel, focusList);

  toolsBar.append(
    layoutControls,
    edgeStyleControl,
    filterDropdown,
    languageDropdown,
    focusTool,
  );

  const crumbBar = document.createElement("div");
  crumbBar.className = "graph-nav-crumb-bar";

  const history = document.createElement("div");
  history.className = "graph-nav-crumb-history";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "graph-nav-crumb-history-btn";
  backBtn.title = t("graph.back");
  backBtn.setAttribute("aria-label", t("graph.back"));
  backBtn.disabled = !canBack;
  backBtn.textContent = "←";
  backBtn.addEventListener("click", callbacks.onBack);

  const forwardBtn = document.createElement("button");
  forwardBtn.type = "button";
  forwardBtn.className = "graph-nav-crumb-history-btn";
  forwardBtn.title = t("graph.forward");
  forwardBtn.setAttribute("aria-label", t("graph.forward"));
  forwardBtn.disabled = !canForward;
  forwardBtn.textContent = "→";
  forwardBtn.addEventListener("click", callbacks.onForward);

  history.append(backBtn, forwardBtn);

  const crumbs = document.createElement("nav");
  crumbs.className = "graph-nav-crumbs";
  crumbs.setAttribute("aria-label", t("graph.graphLocation"));
  nav.crumbs.forEach((crumb, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "graph-nav-sep";
      sep.appendChild(
        lucideIcon(ChevronRight, {
          size: 12,
          class: "lucide-icon graph-nav-sep-icon",
          "stroke-width": 2,
        }),
      );
      crumbs.appendChild(sep);
    }
    const isLast = i === nav.crumbs.length - 1;
    if (isLast) {
      const current = document.createElement("span");
      current.className = "graph-nav-crumb graph-nav-crumb-current";
      current.textContent = crumb.label;
      current.title = crumb.label;
      crumbs.appendChild(current);
    } else {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "graph-nav-crumb graph-nav-crumb-link";
      link.textContent = crumb.label;
      link.title = crumb.label;
      link.addEventListener("click", () => callbacks.onNavigate(crumb));
      crumbs.appendChild(link);
    }
  });

  crumbBar.append(history, crumbs);

  if (options.stats) {
    const stats = document.createElement("span");
    stats.className = "graph-nav-stats";
    stats.textContent = t("graph.modulesDeps", {
      modules: options.stats.nodes,
      deps: options.stats.edges,
    });
    crumbBar.appendChild(stats);
  }

  stack.append(toolsBar, crumbBar);
  container.appendChild(stack);

  if (options.staleImports) {
    const warn = document.createElement("div");
    warn.className = "graph-nav-warning";
    const text = document.createElement("p");
    text.className = "graph-nav-warning-text";
    text.textContent = t("graph.staleImports");
    warn.appendChild(text);
    if (callbacks.onRunAnalysis) {
      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "btn btn-ghost";
      runBtn.textContent = t("toolbar.runAnalysis");
      runBtn.addEventListener("click", () => callbacks.onRunAnalysis?.());
      warn.appendChild(runBtn);
    }
    container.appendChild(warn);
  }
}
