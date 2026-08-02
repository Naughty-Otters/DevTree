import type { IconNode } from "lucide";
import {
  ArrowDown,
  ArrowRight,
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
  summary.textContent = "Filter";
  summary.title = "Show or hide modules by dependency role";

  const menu = document.createElement("div");
  menu.className = "graph-nav-filter-menu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Module filters");

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
  summary.textContent = "Language";
  summary.title = "Show or hide modules by programming language";

  const menu = document.createElement("div");
  menu.className = "graph-nav-filter-menu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Language filters");

  const current = { ...flags };
  const options =
    present && present.length > 0
      ? LANGUAGE_FILTER_OPTIONS.filter((opt) => present.includes(opt.key))
      : LANGUAGE_FILTER_OPTIONS;

  if (options.length === 0) {
    const empty = document.createElement("div");
    empty.className = "graph-nav-filter-empty";
    empty.textContent = "No languages detected yet";
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
    label: "Layout",
    ariaLabel: "Graph layout",
    title: "Change how modules are arranged on the graph",
    items: LAYOUT_FAMILIES.map((mode) => ({
      ...mode,
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
    label: "Flow",
    ariaLabel: "DAG flow style",
    title: "DAG flow direction",
    items: DAG_STYLES.map((style) => ({
      ...style,
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
    label: "Edges",
    ariaLabel: "Edge style",
    title: "How dependency lines are drawn",
    items: EDGE_STYLES.map((style) => ({
      ...style,
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

  const bar = document.createElement("div");
  bar.className = "graph-nav-bar";

  const controls = document.createElement("div");
  controls.className = "graph-nav-controls";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-icon btn-ghost graph-nav-btn";
  backBtn.title = "Back";
  backBtn.disabled = !canBack;
  backBtn.textContent = "←";
  backBtn.addEventListener("click", callbacks.onBack);

  const forwardBtn = document.createElement("button");
  forwardBtn.type = "button";
  forwardBtn.className = "btn btn-icon btn-ghost graph-nav-btn";
  forwardBtn.title = "Forward";
  forwardBtn.disabled = !canForward;
  forwardBtn.textContent = "→";
  forwardBtn.addEventListener("click", callbacks.onForward);

  controls.append(backBtn, forwardBtn);

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
  focusLabel.textContent = "View";
  const focusList = document.createElement("div");
  focusList.className = "graph-nav-icon-list";
  focusList.setAttribute("aria-label", "Graph view actions");
  const focusBtn = document.createElement("button");
  focusBtn.type = "button";
  focusBtn.className = "graph-nav-icon-btn";
  focusBtn.setAttribute("aria-label", "Focus");
  focusBtn.title = "Focus — relayout visible modules and fit view";
  focusBtn.disabled = options.focusEnabled === false;
  focusBtn.appendChild(lucideIcon(Crosshair, TOOL_ICON));
  focusBtn.addEventListener("click", () => callbacks.onFocusView?.());
  focusList.appendChild(focusBtn);
  focusTool.append(focusLabel, focusList);

  const crumbs = document.createElement("nav");
  crumbs.className = "graph-nav-crumbs";
  crumbs.setAttribute("aria-label", "Graph location");

  nav.crumbs.forEach((crumb, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "graph-nav-sep";
      sep.textContent = "›";
      crumbs.appendChild(sep);
    }

    const isLast = i === nav.crumbs.length - 1;
    if (isLast) {
      const current = document.createElement("span");
      current.className = "graph-nav-crumb graph-nav-crumb-current";
      current.textContent = crumb.label;
      crumbs.appendChild(current);
    } else {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "graph-nav-crumb graph-nav-crumb-link";
      link.textContent = crumb.label;
      link.addEventListener("click", () => callbacks.onNavigate(crumb));
      crumbs.appendChild(link);
    }
  });

  if (options.stats) {
    const stats = document.createElement("span");
    stats.className = "graph-nav-stats";
    stats.textContent = `${options.stats.nodes} modules · ${options.stats.edges} deps`;
    crumbs.appendChild(stats);
  }

  const hint = document.createElement("span");
  hint.className = "graph-nav-hint";
  hint.textContent = "Click = details · Double-click = drill / open file";
  hint.title =
    "Click a module for details. Double-click a package to drill in, or a file to open it in the editor.";
  bar.append(
    controls,
    layoutControls,
    edgeStyleControl,
    filterDropdown,
    languageDropdown,
    focusTool,
    crumbs,
    hint,
  );
  container.appendChild(bar);

  if (options.staleImports) {
    const warn = document.createElement("div");
    warn.className = "graph-nav-warning";
    const text = document.createElement("p");
    text.className = "graph-nav-warning-text";
    text.textContent =
      "Import data looks outdated — run analysis again to refresh file and package dependencies.";
    warn.appendChild(text);
    if (callbacks.onRunAnalysis) {
      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "btn btn-ghost";
      runBtn.textContent = "Run analysis";
      runBtn.addEventListener("click", () => callbacks.onRunAnalysis?.());
      warn.appendChild(runBtn);
    }
    container.appendChild(warn);
  }
}
