import { ARCHITECTURE_METRIC_OPTIONS } from "../analysis/architectureHealth";
import type { AnalysisScoreSnapshot } from "../analysis/scoreHistory";
import { lucideIcon } from "./icons";
import { ChevronDown } from "lucide";

export type ScoreSectionId = "overall" | "architecture" | "modularity";

export interface ChartMetricDef {
  /** Unique within section (used as selection key). */
  id: string;
  label: string;
  hint: string;
  /** How to read a numeric value from a snapshot (null if missing). */
  read: (p: AnalysisScoreSnapshot) => number | null;
  /** Prefer 0–100 guides when all visible series use this scale. */
  scale: "score100" | "count" | "percent";
}

const LINE_COLORS = [
  "#58a6ff",
  "#3fb950",
  "#d29922",
  "#f85149",
  "#a371f7",
  "#39c5cf",
  "#db61a2",
  "#8b949e",
];

const SELECTION_STORAGE_KEY = "devtree-score-chart-selection";
const COLLAPSED_STORAGE_KEY = "devtree-score-chart-collapsed";

const OVERALL_METRICS: ChartMetricDef[] = [
  {
    id: "score",
    label: "Overall score",
    hint: "Quality blended with modularity (report headline)",
    read: (p) => p.overall,
    scale: "score100",
  },
  {
    id: "packages",
    label: "Packages",
    hint: "Package count in the last analysis",
    read: (p) => p.overallStats?.packages ?? null,
    scale: "count",
  },
  {
    id: "files",
    label: "Source files",
    hint: "Source files included in the last analysis",
    read: (p) => p.overallStats?.files ?? null,
    scale: "count",
  },
  {
    id: "rules",
    label: "Rules",
    hint: "Validation rules evaluated",
    read: (p) => p.overallStats?.rules ?? null,
    scale: "count",
  },
  {
    id: "passed",
    label: "Passed",
    hint: "Rules that passed",
    read: (p) => p.overallStats?.passed ?? null,
    scale: "count",
  },
  {
    id: "warnings",
    label: "Warnings",
    hint: "Rules with warnings",
    read: (p) => p.overallStats?.warnings ?? null,
    scale: "count",
  },
  {
    id: "failures",
    label: "Failures",
    hint: "Rules that failed",
    read: (p) => p.overallStats?.failures ?? null,
    scale: "count",
  },
  {
    id: "modularityHealth",
    label: "Modularity health",
    hint: "DSM modularity health (same as Modularity section score)",
    read: (p) => p.modularity,
    scale: "score100",
  },
];

const ARCHITECTURE_METRICS: ChartMetricDef[] = [
  {
    id: "score",
    label: "Architecture score",
    hint: "Quality-only architecture health",
    read: (p) => p.architecture,
    scale: "score100",
  },
  ...ARCHITECTURE_METRIC_OPTIONS.map(
    (opt): ChartMetricDef => ({
      id: opt.id,
      label: opt.label,
      hint: `${opt.label} (0–100 absolute threshold score)`,
      read: (p) => p.architectureMetrics?.[opt.id] ?? null,
      scale: "score100",
    }),
  ),
];

const MODULARITY_METRICS: ChartMetricDef[] = [
  {
    id: "score",
    label: "Modularity score",
    hint: "DSM modularity health score",
    read: (p) => p.modularity,
    scale: "score100",
  },
  {
    id: "cycles",
    label: "Cycles",
    hint: "Import / dependency cycle count",
    read: (p) => p.modularityMetrics?.cycles ?? null,
    scale: "count",
  },
  {
    id: "nodesInCycles",
    label: "Nodes in cycles",
    hint: "Modules participating in cycles",
    read: (p) => p.modularityMetrics?.nodesInCycles ?? null,
    scale: "count",
  },
  {
    id: "upperTrianglePct",
    label: "Upper-triangle %",
    hint: "Backward / upward dependency density",
    read: (p) => p.modularityMetrics?.upperTrianglePct ?? null,
    scale: "percent",
  },
  {
    id: "couplingPct",
    label: "Coupling %",
    hint: "Nonzero off-diagonal cells",
    read: (p) => p.modularityMetrics?.couplingPct ?? null,
    scale: "percent",
  },
  {
    id: "propagationPct",
    label: "Propagation %",
    hint: "MacCormack visibility density",
    read: (p) => p.modularityMetrics?.propagationPct ?? null,
    scale: "percent",
  },
  {
    id: "clusteredCostPct",
    label: "Clustered cost %",
    hint: "MacCormack normalized clustered cost",
    read: (p) => p.modularityMetrics?.clusteredCostPct ?? null,
    scale: "percent",
  },
  {
    id: "buses",
    label: "Vertical buses",
    hint: "High fan-in shared modules",
    read: (p) => p.modularityMetrics?.buses ?? null,
    scale: "count",
  },
];

const SECTIONS: {
  id: ScoreSectionId;
  label: string;
  metrics: ChartMetricDef[];
  defaultSelected: string[];
}[] = [
  {
    id: "overall",
    label: "Overall",
    metrics: OVERALL_METRICS,
    defaultSelected: ["score", "failures", "warnings"],
  },
  {
    id: "architecture",
    label: "Architecture health",
    metrics: ARCHITECTURE_METRICS,
    defaultSelected: ["score", "complexity", "maintainability", "coverage"],
  },
  {
    id: "modularity",
    label: "Modularity health",
    metrics: MODULARITY_METRICS,
    defaultSelected: ["score", "cycles", "propagationPct"],
  },
];

type SelectionMap = Record<ScoreSectionId, string[]>;

function defaultSelection(): SelectionMap {
  return {
    overall: [...SECTIONS[0]!.defaultSelected],
    architecture: [...SECTIONS[1]!.defaultSelected],
    modularity: [...SECTIONS[2]!.defaultSelected],
  };
}

function loadSelection(): SelectionMap {
  const base = defaultSelection();
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SelectionMap>;
    for (const section of SECTIONS) {
      const ids = parsed[section.id];
      if (!Array.isArray(ids)) continue;
      const allowed = new Set(section.metrics.map((m) => m.id));
      const cleaned = ids.filter((id) => typeof id === "string" && allowed.has(id));
      if (cleaned.length > 0) base[section.id] = cleaned;
    }
  } catch {
    /* ignore */
  }
  return base;
}

function saveSelection(sel: SelectionMap): void {
  try {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(sel));
  } catch {
    /* ignore */
  }
}

type CollapsedMap = Record<ScoreSectionId, boolean>;

function defaultCollapsed(): CollapsedMap {
  return { overall: false, architecture: false, modularity: false };
}

function loadCollapsed(): CollapsedMap {
  const base = defaultCollapsed();
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<CollapsedMap>;
    for (const id of Object.keys(base) as ScoreSectionId[]) {
      if (typeof parsed[id] === "boolean") base[id] = parsed[id]!;
    }
  } catch {
    /* ignore */
  }
  return base;
}

function saveCollapsed(map: CollapsedMap): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function applyCollapsedState(
  container: HTMLElement,
  collapsed: boolean,
  toggleBtn: HTMLButtonElement,
): void {
  container.classList.toggle("is-collapsed", collapsed);
  toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggleBtn.title = collapsed ? "Show chart" : "Hide chart";
  toggleBtn.setAttribute(
    "aria-label",
    collapsed ? "Show chart" : "Hide chart",
  );
}

function renderChartHeader(
  section: (typeof SECTIONS)[number],
  opts: { embedded?: boolean; onToggle: () => void },
): { header: HTMLElement; toggle: HTMLButtonElement } {
  const header = document.createElement("div");
  header.className = "score-history-header";

  const heading = document.createElement(opts.embedded ? "h4" : "h3");
  heading.className = opts.embedded
    ? "score-history-heading score-history-heading-embedded"
    : "score-history-heading";
  heading.textContent = `${section.label} over time`;
  header.appendChild(heading);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "score-history-toggle";
  const chevron = document.createElement("span");
  chevron.className = "score-history-toggle-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.appendChild(
    lucideIcon(ChevronDown, {
      size: 14,
      class: "lucide-icon",
      "stroke-width": 2,
    }),
  );
  toggle.appendChild(chevron);
  toggle.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    opts.onToggle();
  });
  header.appendChild(toggle);
  return { header, toggle };
}

function formatAxisDate(ms: number): string {
  const d = new Date(ms);
  const mon = d.toLocaleString(undefined, { month: "short" });
  return `${mon} ${d.getDate()}`;
}

function formatTooltipDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function availableMetrics(
  points: AnalysisScoreSnapshot[],
  metrics: ChartMetricDef[],
): ChartMetricDef[] {
  return metrics.filter((m) => points.some((p) => m.read(p) != null));
}

function seriesValues(
  points: AnalysisScoreSnapshot[],
  metric: ChartMetricDef,
): (number | null)[] {
  return points.map((p) => metric.read(p));
}

function yDomain(
  series: { values: (number | null)[]; scale: ChartMetricDef["scale"] }[],
): { min: number; max: number; scoreGuides: boolean } {
  const allScales = new Set(series.map((s) => s.scale));
  const onlyScore =
    allScales.size === 1 && allScales.has("score100");
  const onlyPercent =
    allScales.size === 1 && allScales.has("percent");

  if (onlyScore || onlyPercent) {
    return { min: 0, max: 100, scoreGuides: onlyScore };
  }

  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const v of s.values) {
      if (v == null || !Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 100, scoreGuides: false };
  }
  if (min === max) {
    const pad = Math.max(1, Math.abs(max) * 0.1);
    return { min: Math.max(0, min - pad), max: max + pad, scoreGuides: false };
  }
  const pad = (max - min) * 0.08;
  return {
    min: Math.max(0, min - pad),
    max: max + pad,
    scoreGuides: false,
  };
}

function chartGeometry(
  pointCount: number,
  width: number,
  height: number,
  padX: number,
  padY: number,
  yMin: number,
  yMax: number,
) {
  const spanY = Math.max(yMax - yMin, 1e-9);
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  /** Even spacing by run index so close timestamps still hover separately. */
  const denom = Math.max(pointCount - 1, 1);
  const xAt = (i: number) => padX + (i / denom) * innerW;
  const yAt = (v: number) => padY + (1 - (v - yMin) / spanY) * innerH;
  return { innerW, innerH, xAt, yAt };
}

function polylinePoints(
  values: (number | null)[],
  pointCount: number,
  width: number,
  height: number,
  padX: number,
  padY: number,
  yMin: number,
  yMax: number,
): string {
  const { xAt, yAt } = chartGeometry(
    pointCount,
    width,
    height,
    padX,
    padY,
    yMin,
    yMax,
  );
  const parts: string[] = [];
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) return;
    parts.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
  });
  return parts.join(" ");
}

function formatLatest(v: number, scale: ChartMetricDef["scale"]): string {
  if (scale === "percent") return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
  if (scale === "count") return String(Math.round(v));
  return String(Math.round(v));
}

function clientToSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const vb = svg.viewBox.baseVal;
    return {
      x: ((clientX - rect.left) / rect.width) * (vb.width || 1),
      y: ((clientY - rect.top) / rect.height) * (vb.height || 1),
    };
  }
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

/** Pick the run whose evenly spaced X is closest to the pointer. */
function nearestPointIndex(
  localX: number,
  pointCount: number,
  xAt: (i: number) => number,
): number {
  if (pointCount <= 1) return 0;
  let best = 0;
  let bestDist = Math.abs(xAt(0) - localX);
  for (let i = 1; i < pointCount; i++) {
    const d = Math.abs(xAt(i) - localX);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

function attachDatapointTooltip(
  wrap: HTMLElement,
  svg: SVGSVGElement,
  times: number[],
  plotted: {
    metric: ChartMetricDef;
    values: (number | null)[];
    color: string;
  }[],
  geom: ReturnType<typeof chartGeometry>,
  dims: { width: number; height: number; padX: number; padY: number },
): void {
  const tip = document.createElement("div");
  tip.className = "score-history-tooltip hidden";
  tip.setAttribute("role", "tooltip");
  wrap.appendChild(tip);

  const crosshair = document.createElementNS("http://www.w3.org/2000/svg", "line");
  crosshair.setAttribute("class", "score-history-crosshair");
  crosshair.setAttribute("y1", String(dims.padY));
  crosshair.setAttribute("y2", String(dims.height - dims.padY));
  crosshair.setAttribute("visibility", "hidden");
  svg.appendChild(crosshair);

  type HoverMark = { ring: SVGCircleElement; core: SVGCircleElement };
  const highlights: HoverMark[] = [];
  for (const row of plotted) {
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    ring.setAttribute("class", "score-history-hover-ring");
    ring.setAttribute("r", "6");
    ring.setAttribute("fill", row.color);
    ring.setAttribute("fill-opacity", "0.22");
    ring.setAttribute("stroke", "none");
    ring.setAttribute("visibility", "hidden");
    svg.appendChild(ring);

    const core = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    core.setAttribute("class", "score-history-hover-dot");
    core.setAttribute("r", "3.25");
    core.setAttribute("fill", row.color);
    core.setAttribute("stroke", "var(--bg-panel)");
    core.setAttribute("stroke-width", "1.5");
    core.setAttribute("visibility", "hidden");
    svg.appendChild(core);

    highlights.push({ ring, core });
  }

  // Transparent hit layer keeps a consistent hover surface over strokes.
  const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  hit.setAttribute("class", "score-history-hit");
  hit.setAttribute("x", "0");
  hit.setAttribute("y", "0");
  hit.setAttribute("width", String(dims.width));
  hit.setAttribute("height", String(dims.height));
  hit.setAttribute("fill", "transparent");
  svg.appendChild(hit);

  const hide = () => {
    wrap.removeAttribute("data-hover-index");
    tip.classList.add("hidden");
    crosshair.setAttribute("visibility", "hidden");
    for (const mark of highlights) {
      mark.ring.setAttribute("visibility", "hidden");
      mark.core.setAttribute("visibility", "hidden");
    }
  };

  const showAt = (index: number, clientX: number, clientY: number) => {
    wrap.dataset.hoverIndex = String(index);
    const x = geom.xAt(index);
    crosshair.setAttribute("x1", x.toFixed(1));
    crosshair.setAttribute("x2", x.toFixed(1));
    crosshair.setAttribute("visibility", "visible");

    const rows: string[] = [];
    plotted.forEach((row, i) => {
      const v = row.values[index];
      const mark = highlights[i]!;
      if (v == null || !Number.isFinite(v)) {
        mark.ring.setAttribute("visibility", "hidden");
        mark.core.setAttribute("visibility", "hidden");
        return;
      }
      const y = geom.yAt(v);
      const cx = x.toFixed(1);
      const cy = y.toFixed(1);
      mark.ring.setAttribute("cx", cx);
      mark.ring.setAttribute("cy", cy);
      mark.ring.setAttribute("visibility", "visible");
      mark.core.setAttribute("cx", cx);
      mark.core.setAttribute("cy", cy);
      mark.core.setAttribute("visibility", "visible");
      rows.push(
        `<div class="score-history-tooltip-row"><span class="score-history-legend-swatch" style="background:${row.color}"></span><span>${row.metric.label}</span><strong>${formatLatest(v, row.metric.scale)}</strong></div>`,
      );
    });

    if (rows.length === 0) {
      hide();
      return;
    }

    tip.innerHTML = `<div class="score-history-tooltip-date">${formatTooltipDate(times[index]!)}</div>${rows.join("")}`;
    tip.classList.remove("hidden");

    const wrapRect = wrap.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    let left = clientX - wrapRect.left + 12;
    let top = clientY - wrapRect.top - tipH - 10;
    if (left + tipW > wrapRect.width - 4) {
      left = clientX - wrapRect.left - tipW - 12;
    }
    if (left < 4) left = 4;
    if (top < 4) top = clientY - wrapRect.top + 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const onMove = (ev: PointerEvent | MouseEvent) => {
    const local = clientToSvgPoint(svg, ev.clientX, ev.clientY);
    const index = nearestPointIndex(local.x, times.length, geom.xAt);
    showAt(index, ev.clientX, ev.clientY);
  };

  // Listen on the wrap so edge padding / letterboxing still tracks.
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerleave", hide);
}

function renderSectionCard(
  points: AnalysisScoreSnapshot[],
  section: (typeof SECTIONS)[number],
  selectedIds: string[],
  onSelectionChange: (ids: string[]) => void,
  opts: { hideTitle?: boolean } = {},
): HTMLElement {
  const card = document.createElement("div");
  card.className = "score-history-card";

  if (!opts.hideTitle) {
    const header = document.createElement("div");
    header.className = "score-history-card-header";
    const title = document.createElement("h4");
    title.className = "score-history-card-title";
    title.textContent = section.label;
    header.appendChild(title);
    card.appendChild(header);
  }

  const available = availableMetrics(points, section.metrics);
  let selected = selectedIds.filter((id) => available.some((m) => m.id === id));
  if (selected.length === 0 && available.length > 0) {
    selected = [available[0]!.id];
  }

  const picker = document.createElement("div");
  picker.className = "score-history-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", `${section.label} metrics`);

  for (const metric of available) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "score-history-chip";
    btn.classList.toggle("is-active", selected.includes(metric.id));
    btn.textContent = metric.label;
    btn.title = metric.hint;
    btn.setAttribute("aria-pressed", selected.includes(metric.id) ? "true" : "false");
    btn.addEventListener("click", () => {
      const next = selected.includes(metric.id)
        ? selected.filter((id) => id !== metric.id)
        : [...selected, metric.id];
      if (next.length === 0) return;
      onSelectionChange(next);
    });
    picker.appendChild(btn);
  }
  card.appendChild(picker);

  if (available.length === 0) {
    const empty = document.createElement("p");
    empty.className = "score-history-card-empty";
    empty.textContent = "No sub-metrics recorded yet — re-run analysis.";
    card.appendChild(empty);
    return card;
  }

  const activeMetrics = available.filter((m) => selected.includes(m.id));
  const times = points.map((p) => p.at);
  const plotted = activeMetrics.map((m, i) => ({
    metric: m,
    values: seriesValues(points, m),
    color: LINE_COLORS[i % LINE_COLORS.length]!,
  }));
  const domain = yDomain(
    plotted.map((p) => ({ values: p.values, scale: p.metric.scale })),
  );

  const width = 320;
  const height = 110;
  const padX = 10;
  const padY = 12;
  const geom = chartGeometry(
    points.length,
    width,
    height,
    padX,
    padY,
    domain.min,
    domain.max,
  );

  const chartWrap = document.createElement("div");
  chartWrap.className = "score-history-chart-wrap";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "score-history-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // Keep circles round; pointer mapping uses getScreenCTM.
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${section.label}: ${activeMetrics.map((m) => m.label).join(", ")}`,
  );

  if (domain.scoreGuides) {
    for (const guide of [50, 80]) {
      const y = geom.yAt(guide);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(padX));
      line.setAttribute("x2", String(width - padX));
      line.setAttribute("y1", y.toFixed(1));
      line.setAttribute("y2", y.toFixed(1));
      line.setAttribute("class", "score-history-guide");
      svg.appendChild(line);
    }
  }

  const legend = document.createElement("div");
  legend.className = "score-history-legend";

  for (const row of plotted) {
    const pts = polylinePoints(
      row.values,
      points.length,
      width,
      height,
      padX,
      padY,
      domain.min,
      domain.max,
    );
    if (!pts) continue;
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", pts);
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", row.color);
    poly.setAttribute("stroke-width", "1.75");
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute("class", "score-history-line");
    svg.appendChild(poly);

    row.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return;
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", geom.xAt(i).toFixed(1));
      dot.setAttribute("cy", geom.yAt(v).toFixed(1));
      dot.setAttribute("r", "2");
      dot.setAttribute("fill", row.color);
      dot.setAttribute("stroke", "none");
      dot.setAttribute("class", "score-history-dot");
      svg.appendChild(dot);
    });

    let lastIdx = -1;
    for (let i = row.values.length - 1; i >= 0; i--) {
      if (row.values[i] != null) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx >= 0) {
      const v = row.values[lastIdx]!;
      const item = document.createElement("span");
      item.className = "score-history-legend-item";
      item.innerHTML = `<span class="score-history-legend-swatch" style="background:${row.color}"></span>${row.metric.label} <strong>${formatLatest(v, row.metric.scale)}</strong>`;
      legend.appendChild(item);
    }
  }

  chartWrap.appendChild(svg);
  attachDatapointTooltip(chartWrap, svg, times, plotted, geom, {
    width,
    height,
    padX,
    padY,
  });
  card.appendChild(chartWrap);
  if (legend.childElementCount > 0) card.appendChild(legend);

  const footer = document.createElement("div");
  footer.className = "score-history-card-footer";
  const firstLabel = document.createElement("span");
  firstLabel.textContent = formatAxisDate(times[0]!);
  const lastLabel = document.createElement("span");
  lastLabel.textContent = formatAxisDate(times[times.length - 1]!);
  lastLabel.title = formatTooltipDate(times[times.length - 1]!);
  footer.append(firstLabel, lastLabel);
  card.appendChild(footer);

  return card;
}

/** Render one section chart into a host (embedded under its report section). */
export function renderScoreHistorySection(
  container: HTMLElement,
  sectionId: ScoreSectionId,
  points: AnalysisScoreSnapshot[],
  opts: { embedded?: boolean } = {},
): void {
  const section = SECTIONS.find((s) => s.id === sectionId);
  if (!section) return;

  const collapsedMap = loadCollapsed();
  let collapsed = collapsedMap[sectionId];

  container.replaceChildren();
  container.className = opts.embedded
    ? "score-history score-history-embedded"
    : "score-history";

  const body = document.createElement("div");
  body.className = "score-history-body";

  const { header, toggle } = renderChartHeader(section, {
    embedded: opts.embedded,
    onToggle: () => {
      collapsed = !collapsed;
      collapsedMap[sectionId] = collapsed;
      saveCollapsed(collapsedMap);
      applyCollapsedState(container, collapsed, toggle);
    },
  });
  container.appendChild(header);
  container.appendChild(body);
  applyCollapsedState(container, collapsed, toggle);

  if (points.length < 2) {
    const empty = document.createElement("p");
    empty.className = "score-history-empty";
    empty.textContent =
      points.length === 1
        ? "One analysis recorded — run again to see trends."
        : "Run analysis more than once to chart progress.";
    body.appendChild(empty);
    return;
  }

  const selection = loadSelection();
  body.appendChild(
    renderSectionCard(
      points,
      section,
      selection[sectionId],
      (ids) => {
        selection[sectionId] = ids;
        saveSelection(selection);
        renderScoreHistorySection(container, sectionId, points, opts);
      },
      { hideTitle: Boolean(opts.embedded) },
    ),
  );
}

/** Async mount helper for report sections. */
export function mountScoreHistorySection(
  container: HTMLElement,
  sectionId: ScoreSectionId,
  getHistory?: () => Promise<AnalysisScoreSnapshot[]>,
): void {
  container.className = "score-history score-history-embedded";
  const request = getHistory?.();
  if (!request) {
    renderScoreHistorySection(container, sectionId, [], { embedded: true });
    return;
  }
  void request
    .then((points) => {
      renderScoreHistorySection(container, sectionId, points, { embedded: true });
    })
    .catch(() => {
      renderScoreHistorySection(container, sectionId, [], { embedded: true });
    });
}

/** Combined three-card layout (tests / fallback). */
export function renderScoreHistoryCharts(
  container: HTMLElement,
  points: AnalysisScoreSnapshot[],
): void {
  container.replaceChildren();
  container.className = "score-history";

  const heading = document.createElement("h3");
  heading.className = "score-history-heading";
  heading.textContent = "Health over time";
  container.appendChild(heading);

  if (points.length < 2) {
    const empty = document.createElement("p");
    empty.className = "score-history-empty";
    empty.textContent =
      points.length === 1
        ? "One analysis recorded — run again to see trends."
        : "Run analysis more than once to chart health progress.";
    container.appendChild(empty);
    return;
  }

  const selection = loadSelection();
  const collapsedMap = loadCollapsed();
  const grid = document.createElement("div");
  grid.className = "score-history-grid";
  for (const section of SECTIONS) {
    const cell = document.createElement("div");
    cell.className = "score-history score-history-cell";
    let collapsed = collapsedMap[section.id];
    const body = document.createElement("div");
    body.className = "score-history-body";

    const { header, toggle } = renderChartHeader(section, {
      onToggle: () => {
        collapsed = !collapsed;
        collapsedMap[section.id] = collapsed;
        saveCollapsed(collapsedMap);
        applyCollapsedState(cell, collapsed, toggle);
      },
    });
    cell.appendChild(header);
    cell.appendChild(body);
    applyCollapsedState(cell, collapsed, toggle);

    body.appendChild(
      renderSectionCard(points, section, selection[section.id], (ids) => {
        selection[section.id] = ids;
        saveSelection(selection);
        renderScoreHistoryCharts(container, points);
      }, { hideTitle: true }),
    );
    grid.appendChild(cell);
  }
  container.appendChild(grid);
}

/** Exported for tests. */
export const __scoreHistoryChartTest = {
  SECTIONS,
  availableMetrics,
  loadSelection,
  defaultSelection,
  nearestPointIndex,
  chartGeometry,
};
