import type { AnalysisResult, AnalysisProgress } from "../analysis/types";

type TabId = "analysis" | "validation" | "suggestions";

export function createResultsPanel(container: HTMLElement): {
  setResult: (result: AnalysisResult | null) => void;
  setRunning: (running: boolean) => void;
  setProgress: (progress: AnalysisProgress) => void;
} {
  let activeTab: TabId = "analysis";
  let currentResult: AnalysisResult | null = null;
  let running = false;
  let progress: AnalysisProgress | null = null;

  const tabs = document.createElement("div");
  tabs.className = "results-tabs";

  const tabDefs: { id: TabId; label: string }[] = [
    { id: "analysis", label: "Analysis" },
    { id: "validation", label: "Validation" },
    { id: "suggestions", label: "Suggestions" },
  ];

  const tabButtons: Record<TabId, HTMLButtonElement> = {} as Record<
    TabId,
    HTMLButtonElement
  >;

  for (const def of tabDefs) {
    const btn = document.createElement("button");
    btn.className = "results-tab";
    btn.textContent = def.label;
    btn.dataset.tab = def.id;
    if (def.id === activeTab) btn.classList.add("active");
    btn.addEventListener("click", () => {
      activeTab = def.id;
      Object.values(tabButtons).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderContent();
    });
    tabButtons[def.id] = btn;
    tabs.appendChild(btn);
  }

  const content = document.createElement("div");
  content.className = "results-content";

  container.append(tabs, content);

  function renderProgress(): void {
    content.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "analysis-progress";

    const title = document.createElement("div");
    title.className = "analysis-progress-title";
    title.textContent = "Running analysis…";

    const message = document.createElement("div");
    message.className = "analysis-progress-message";
    message.textContent = progress?.message ?? "Preparing…";

    const track = document.createElement("div");
    track.className = "analysis-progress-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    const pct = Math.max(0, Math.min(100, progress?.percent ?? 0));
    track.setAttribute("aria-valuenow", String(pct));

    const fill = document.createElement("div");
    fill.className = "analysis-progress-fill";
    fill.style.width = `${pct}%`;
    if (!progress || progress.total === 0) {
      fill.classList.add("analysis-progress-fill-indeterminate");
    }

    track.appendChild(fill);

    const meta = document.createElement("div");
    meta.className = "analysis-progress-meta";
    const stage = progress?.stage ? progress.stage : "…";
    const counts =
      progress && progress.total > 0
        ? `${progress.current}/${progress.total}`
        : progress
          ? `${progress.current} found`
          : "";
    meta.textContent = counts ? `${stage} · ${counts} · ${pct}%` : `${stage} · ${pct}%`;

    wrap.append(title, message, track, meta);
    content.appendChild(wrap);
  }

  function renderContent(): void {
    if (running) {
      renderProgress();
      return;
    }

    content.innerHTML = "";
    if (!currentResult) {
      const empty = document.createElement("div");
      empty.className = "panel-empty";
      empty.textContent = "Run analysis to see results";
      content.appendChild(empty);
      return;
    }

    switch (activeTab) {
      case "analysis":
        renderAnalysisTab(content, currentResult);
        break;
      case "validation":
        renderValidationTab(content, currentResult);
        break;
      case "suggestions":
        renderSuggestionsTab(content, currentResult);
        break;
    }
  }

  return {
    setResult(result: AnalysisResult | null) {
      running = false;
      progress = null;
      currentResult = result;
      renderContent();
    },
    setRunning(isRunning: boolean) {
      running = isRunning;
      if (isRunning) {
        progress = {
          stage: "starting",
          message: "Preparing analysis…",
          current: 0,
          total: 0,
          percent: 0,
        };
      } else {
        progress = null;
      }
      renderContent();
    },
    setProgress(next: AnalysisProgress) {
      running = true;
      progress = next;
      renderProgress();
    },
  };
}

function renderAnalysisTab(
  container: HTMLElement,
  result: AnalysisResult,
): void {
  const summary = document.createElement("div");
  summary.className = "result-summary";
  summary.textContent = result.summary;
  container.appendChild(summary);

  const stats = document.createElement("div");
  stats.className = "result-stats";

  const nodeCount = result.graph.nodes.length;
  const edgeCount = result.graph.edges.length;
  const passCount = result.validation.filter((v) => v.status === "pass").length;
  const warnCount = result.validation.filter((v) => v.status === "warn").length;
  const failCount = result.validation.filter((v) => v.status === "fail").length;

  stats.innerHTML = `
    <div class="stat"><span class="stat-value">${nodeCount}</span><span class="stat-label">Modules</span></div>
    <div class="stat"><span class="stat-value">${edgeCount}</span><span class="stat-label">Dependencies</span></div>
    <div class="stat stat-pass"><span class="stat-value">${passCount}</span><span class="stat-label">Passed</span></div>
    <div class="stat stat-warn"><span class="stat-value">${warnCount}</span><span class="stat-label">Warnings</span></div>
    <div class="stat stat-fail"><span class="stat-value">${failCount}</span><span class="stat-label">Failures</span></div>
  `;
  container.appendChild(stats);
}

function renderValidationTab(
  container: HTMLElement,
  result: AnalysisResult,
): void {
  if (result.validation.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No validation rules were run";
    container.appendChild(empty);
    return;
  }

  for (const item of result.validation) {
    const row = document.createElement("div");
    row.className = `validation-item validation-${item.status}`;

    const badge = document.createElement("span");
    badge.className = `validation-badge badge-${item.status}`;
    badge.textContent = item.status.toUpperCase();

    const body = document.createElement("div");
    body.className = "validation-body";

    const title = document.createElement("div");
    title.className = "validation-title";
    title.textContent = item.rule_name;

    const msg = document.createElement("div");
    msg.className = "validation-message";
    msg.textContent = item.message;

    body.append(title, msg);

    if (item.affected.length > 0) {
      const affected = document.createElement("div");
      affected.className = "validation-affected";
      affected.textContent = item.affected.slice(0, 5).join(", ");
      if (item.affected.length > 5) {
        affected.textContent += ` (+${item.affected.length - 5} more)`;
      }
      body.appendChild(affected);
    }

    row.append(badge, body);
    container.appendChild(row);
  }
}

function renderSuggestionsTab(
  container: HTMLElement,
  result: AnalysisResult,
): void {
  if (result.suggestions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No suggestions";
    container.appendChild(empty);
    return;
  }

  for (const item of result.suggestions) {
    const row = document.createElement("div");
    row.className = `suggestion-item priority-${item.priority}`;

    const badge = document.createElement("span");
    badge.className = `suggestion-priority priority-${item.priority}`;
    badge.textContent = item.priority;

    const body = document.createElement("div");
    body.className = "suggestion-body";

    const title = document.createElement("div");
    title.className = "suggestion-title";
    title.textContent = item.title;

    const desc = document.createElement("div");
    desc.className = "suggestion-desc";
    desc.textContent = item.description;

    body.append(title, desc);

    if (item.targets.length > 0) {
      const targets = document.createElement("div");
      targets.className = "suggestion-targets";
      targets.textContent = item.targets.slice(0, 3).join(", ");
      body.appendChild(targets);
    }

    row.append(badge, body);
    container.appendChild(row);
  }
}
