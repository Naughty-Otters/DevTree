import type { AnalysisResult, RuleTaskProgress } from "../analysis/types";
import type { HierarchyIndex } from "../analysis/types";
import type { AnalysisRun } from "../analysis/manager";
import {
  effectiveRuleStatus,
  getPipelineStages,
  overallProgressMeta,
  overallProgressPercent,
  pipelineStageFillPercent,
  pipelineStageStatus,
  ruleTaskFillPercent,
} from "../analysis/progressDisplay";
import { cycleGroupsFromValidation } from "../validation/cycles";
import { findSymbolAtLine } from "../validation/navigation";
import {
  showValidationDetail,
  type ValidationDetailHandlers,
} from "./validationDetailPopup";
import {
  showAnalysisStatDetail,
  type AnalysisDetailHandlers,
  type AnalysisStatKind,
} from "./analysisDetailPopup";

type TabId = "analysis" | "validation";

export interface ResultsPanelHandlers {
  onOpenValidationTarget?: ValidationDetailHandlers["onOpenFile"];
  onShowValidationOnGraph?: ValidationDetailHandlers["onShowOnGraph"];
  onShowCycleOnGraph?: ValidationDetailHandlers["onShowCycleOnGraph"];
  onShowModuleOnGraph?: AnalysisDetailHandlers["onShowModuleOnGraph"];
  onShowDependencyOnGraph?: AnalysisDetailHandlers["onShowDependencyOnGraph"];
  getHierarchy?: () => HierarchyIndex | null;
  onCancelRun?: (id: string) => void;
  onCancelAllRuns?: () => void;
  onApplyRun?: (id: string) => void;
}

export function createResultsPanel(
  container: HTMLElement,
  handlers: ResultsPanelHandlers = {},
): {
  setResult: (result: AnalysisResult | null) => void;
  setRuns: (runs: AnalysisRun[]) => void;
} {
  let activeTab: TabId = "analysis";
  let currentResult: AnalysisResult | null = null;
  let activeRuns: AnalysisRun[] = [];

  const tabs = document.createElement("div");
  tabs.className = "results-tabs";

  const tabDefs: { id: TabId; label: string }[] = [
    { id: "analysis", label: "Analysis" },
    { id: "validation", label: "Validation" },
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

  const runsHost = document.createElement("div");
  runsHost.className = "analysis-runs-section";
  runsHost.hidden = true;

  const resultsHost = document.createElement("div");
  resultsHost.className = "results-tab-content";

  const emptyHost = document.createElement("div");
  emptyHost.className = "panel-empty";
  emptyHost.textContent = "Run analysis to see results";
  emptyHost.hidden = true;

  content.append(runsHost, resultsHost, emptyHost);
  container.append(tabs, content);

  interface TaskBarRefs {
    row: HTMLElement;
    icon: HTMLElement;
    statusLabel: HTMLElement;
    fill: HTMLElement;
    track: HTMLElement;
  }

  interface RunCardRefs {
    root: HTMLElement;
    message: HTMLElement;
    overallTrack: HTMLElement;
    overallFill: HTMLElement;
    overallMeta: HTMLElement;
    actions: HTMLElement;
    rulesHeading: HTMLElement | null;
    rulesList: HTMLElement | null;
    pipelineBars: Map<string, TaskBarRefs>;
    ruleBars: Map<string, TaskBarRefs>;
  }

  const runCards = new Map<string, RunCardRefs>();
  let runsHeadingEl: HTMLElement | null = null;
  let runsHeadingText: HTMLElement | null = null;
  let cancelAllBtn: HTMLButtonElement | null = null;
  let runsCardsHost: HTMLElement | null = null;

  function statusIcon(status: RuleTaskProgress["status"]): string {
    if (status === "done") return "✓";
    if (status === "running") return "◐";
    if (status === "failed") return "✕";
    return "○";
  }

  function statusLabelText(status: RuleTaskProgress["status"]): string {
    if (status === "running") return "Running";
    if (status === "done") return "Done";
    if (status === "failed") return "Failed";
    return "Waiting";
  }

  function createTaskBar(label: string, key: string): TaskBarRefs {
    const row = document.createElement("div");
    row.className = "analysis-rule-task-row analysis-rule-task-pending";
    row.dataset.taskKey = key;

    const header = document.createElement("div");
    header.className = "analysis-rule-task-header";

    const icon = document.createElement("span");
    icon.className = "analysis-rule-task-icon";
    icon.textContent = "○";

    const name = document.createElement("span");
    name.className = "analysis-rule-task-name";
    name.textContent = label;

    const statusLabel = document.createElement("span");
    statusLabel.className = "analysis-rule-task-status";
    statusLabel.textContent = "Waiting";

    header.append(icon, name, statusLabel);

    const track = document.createElement("div");
    track.className = "analysis-progress-track analysis-rule-progress-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", "0");

    const fill = document.createElement("div");
    fill.className = "analysis-progress-fill";
    fill.style.width = "0%";
    track.appendChild(fill);

    row.append(header, track);
    return { row, icon, statusLabel, fill, track };
  }

  function updateTaskBar(
    refs: TaskBarRefs,
    status: RuleTaskProgress["status"],
    fillPercent: number,
  ): void {
    refs.row.className = `analysis-rule-task-row analysis-rule-task-${status}`;
    refs.icon.textContent = statusIcon(status);
    refs.statusLabel.textContent = statusLabelText(status);
    refs.track.setAttribute("aria-valuenow", String(fillPercent));
    refs.fill.className = "analysis-progress-fill";
    refs.fill.style.width = `${fillPercent}%`;
    if (status === "failed") {
      refs.fill.classList.add("analysis-progress-fill-error");
    } else if (status === "done") {
      refs.fill.classList.add("analysis-progress-fill-done");
    }
  }

  function createRunCard(run: AnalysisRun): RunCardRefs {
    const root = document.createElement("div");
    root.className = `analysis-run-card analysis-run-${run.status}`;
    root.dataset.runId = run.id;

    const header = document.createElement("div");
    header.className = "analysis-run-header";

    const title = document.createElement("div");
    title.className = "analysis-run-title";
    title.textContent = run.label;

    const actions = document.createElement("div");
    actions.className = "analysis-run-actions";
    header.append(title, actions);

    const message = document.createElement("div");
    message.className = "analysis-progress-message";

    const overallWrap = document.createElement("div");
    overallWrap.className = "analysis-progress-overall";

    const overallTrack = document.createElement("div");
    overallTrack.className = "analysis-progress-track analysis-progress-track-overall";
    overallTrack.setAttribute("role", "progressbar");
    overallTrack.setAttribute("aria-valuemin", "0");
    overallTrack.setAttribute("aria-valuemax", "100");
    overallTrack.setAttribute("aria-valuenow", "0");

    const overallFill = document.createElement("div");
    overallFill.className = "analysis-progress-fill";
    overallFill.style.width = "0%";
    overallTrack.appendChild(overallFill);

    const overallMeta = document.createElement("div");
    overallMeta.className = "analysis-progress-meta";

    overallWrap.append(overallTrack, overallMeta);

    const pipelineHeading = document.createElement("div");
    pipelineHeading.className = "analysis-pipeline-label";
    pipelineHeading.textContent = "Pipeline";

    const pipelineList = document.createElement("div");
    pipelineList.className = "analysis-rule-tasks analysis-pipeline-tasks";

    const pipelineBars = new Map<string, TaskBarRefs>();
    for (const stage of getPipelineStages()) {
      const bar = createTaskBar(stage.label, stage.id);
      pipelineBars.set(stage.id, bar);
      pipelineList.appendChild(bar.row);
    }

    root.append(header, message, overallWrap, pipelineHeading, pipelineList);

    return {
      root,
      message,
      overallTrack,
      overallFill,
      overallMeta,
      actions,
      rulesHeading: null,
      rulesList: null,
      pipelineBars,
      ruleBars: new Map(),
    };
  }

  function updateRunActions(refs: RunCardRefs, run: AnalysisRun): void {
    refs.actions.replaceChildren();
    if (run.status === "running") {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-ghost analysis-run-cancel";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => handlers.onCancelRun?.(run.id));
      refs.actions.appendChild(cancelBtn);
      return;
    }
    if (run.status === "completed" && run.result) {
      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "btn btn-ghost analysis-run-apply";
      applyBtn.textContent = "Apply";
      applyBtn.addEventListener("click", () => handlers.onApplyRun?.(run.id));
      refs.actions.appendChild(applyBtn);
    }
  }

  function syncRuleTaskBars(
    refs: RunCardRefs,
    ruleTasks: RuleTaskProgress[],
    currentStage: string,
    progress: AnalysisRun["progress"],
  ): void {
    const ruleIds = new Set(ruleTasks.map((task) => task.ruleId));

    for (const [ruleId, bar] of refs.ruleBars) {
      if (!ruleIds.has(ruleId)) {
        bar.row.remove();
        refs.ruleBars.delete(ruleId);
      }
    }

    if (ruleTasks.length === 0) {
      refs.rulesHeading?.remove();
      refs.rulesList?.remove();
      refs.rulesHeading = null;
      refs.rulesList = null;
      return;
    }

    if (!refs.rulesHeading) {
      refs.rulesHeading = document.createElement("div");
      refs.rulesHeading.className = "analysis-rules-heading";
      refs.root.appendChild(refs.rulesHeading);
    }

    if (!refs.rulesList) {
      refs.rulesList = document.createElement("div");
      refs.rulesList.className = "analysis-rule-tasks";
      refs.root.appendChild(refs.rulesList);
    }

    const runningCount = ruleTasks.filter((task) => task.status === "running").length;
    const doneCount = ruleTasks.filter(
      (task) => task.status === "done" || task.status === "failed",
    ).length;
    refs.rulesHeading.textContent =
      currentStage === "validating" || runningCount > 0
        ? `Rules (${runningCount} running in parallel · ${doneCount}/${ruleTasks.length} done)`
        : `Rules (${doneCount}/${ruleTasks.length} done)`;

    for (const task of ruleTasks) {
      let bar = refs.ruleBars.get(task.ruleId);
      if (!bar) {
        bar = createTaskBar(task.ruleName, task.ruleId);
        refs.ruleBars.set(task.ruleId, bar);
        refs.rulesList.appendChild(bar.row);
      } else {
        bar.row.querySelector(".analysis-rule-task-name")!.textContent = task.ruleName;
      }

      const status = effectiveRuleStatus(task);
      const fill = ruleTaskFillPercent(task, progress);
      updateTaskBar(bar, status, fill);
    }
  }

  function updateRunCard(refs: RunCardRefs, run: AnalysisRun): void {
    refs.root.className = `analysis-run-card analysis-run-${run.status}`;
    updateRunActions(refs, run);

    const progress = run.progress;
    const currentStage = progress?.stage ?? "starting";
    const ruleTasks =
      run.ruleTasks.length > 0
        ? run.ruleTasks
        : (progress?.ruleTasks ?? []);

    if (run.status === "failed") {
      refs.message.textContent = run.error ?? "Analysis failed";
    } else if (run.status === "cancelled") {
      refs.message.textContent = "Cancelled";
    } else {
      refs.message.textContent = progress?.message ?? "Preparing…";
    }

    const overallPct = overallProgressPercent(progress);
    refs.overallTrack.setAttribute("aria-valuenow", String(overallPct));
    refs.overallFill.style.width = `${overallPct}%`;
    refs.overallFill.className = "analysis-progress-fill";
    if (run.status === "completed") {
      refs.overallFill.classList.add("analysis-progress-fill-done");
    }

    if (run.status === "running" && progress) {
      refs.overallMeta.textContent = overallProgressMeta(progress);
      refs.overallMeta.hidden = false;
    } else if (run.status === "completed") {
      refs.overallMeta.textContent = "Complete · 100%";
      refs.overallMeta.hidden = false;
    } else {
      refs.overallMeta.hidden = true;
    }

    for (const stage of getPipelineStages()) {
      const bar = refs.pipelineBars.get(stage.id);
      if (!bar) continue;
      const status = pipelineStageStatus(currentStage, stage.id);
      const fill = pipelineStageFillPercent(currentStage, stage.id, progress);
      updateTaskBar(bar, status, fill);
    }

    syncRuleTaskBars(refs, ruleTasks, currentStage, progress);
  }

  function updateActiveRuns(): void {
    const visible = activeRuns.filter((run) => run.status === "running");
    const visibleIds = new Set(visible.map((run) => run.id));

    if (visible.length === 0) {
      runsHost.hidden = true;
      runsHost.replaceChildren();
      runCards.clear();
      runsHeadingEl = null;
      runsHeadingText = null;
      cancelAllBtn = null;
      runsCardsHost = null;
      return;
    }

    runsHost.hidden = false;

    if (!runsHeadingEl) {
      runsHeadingEl = document.createElement("div");
      runsHeadingEl.className = "analysis-runs-heading";
      runsHeadingText = document.createElement("span");
      runsHeadingText.className = "analysis-runs-heading-text";
      runsHeadingEl.appendChild(runsHeadingText);
      runsHost.appendChild(runsHeadingEl);
    }

    const runningCount = visible.length;
    runsHeadingText!.textContent =
      `${runningCount} analysis run${runningCount === 1 ? "" : "s"} in progress`;

    if (runningCount > 1) {
      if (!cancelAllBtn) {
        cancelAllBtn = document.createElement("button");
        cancelAllBtn.type = "button";
        cancelAllBtn.className = "btn btn-ghost analysis-runs-cancel-all";
        cancelAllBtn.textContent = "Cancel all";
        cancelAllBtn.addEventListener("click", () => handlers.onCancelAllRuns?.());
        runsHeadingEl.appendChild(cancelAllBtn);
      }
    } else if (cancelAllBtn) {
      cancelAllBtn.remove();
      cancelAllBtn = null;
    }

    if (!runsCardsHost) {
      runsCardsHost = document.createElement("div");
      runsCardsHost.className = "analysis-runs-cards";
      runsHost.appendChild(runsCardsHost);
    }

    for (const [id, refs] of runCards) {
      if (!visibleIds.has(id)) {
        refs.root.remove();
        runCards.delete(id);
      }
    }

    for (const run of visible) {
      let refs = runCards.get(run.id);
      if (!refs) {
        refs = createRunCard(run);
        runCards.set(run.id, refs);
        runsCardsHost.appendChild(refs.root);
      }
      updateRunCard(refs, run);
    }
  }

  function renderResults(): void {
    resultsHost.replaceChildren();
    if (!currentResult) {
      resultsHost.hidden = true;
      return;
    }

    resultsHost.hidden = false;
    switch (activeTab) {
      case "analysis":
        renderAnalysisTab(resultsHost, currentResult, handlers);
        break;
      case "validation":
        renderValidationTab(resultsHost, currentResult, handlers);
        break;
    }
  }

  function renderContent(): void {
    updateActiveRuns();

    const hasRunning = activeRuns.some((run) => run.status === "running");
    emptyHost.hidden = hasRunning || currentResult !== null;

    renderResults();
  }

  return {
    setResult(result: AnalysisResult | null) {
      currentResult = result;
      renderContent();
    },
    setRuns(runs: AnalysisRun[]) {
      activeRuns = runs;
      updateActiveRuns();
      const hasRunning = activeRuns.some((run) => run.status === "running");
      emptyHost.hidden = hasRunning || currentResult !== null;
    },
  };
}

function renderAnalysisTab(
  container: HTMLElement,
  result: AnalysisResult,
  handlers: ResultsPanelHandlers,
): void {
  const summary = document.createElement("div");
  summary.className = "result-summary";
  summary.textContent = result.summary;
  container.appendChild(summary);

  const stats = document.createElement("div");
  stats.className = "result-stats";

  const statDefs: {
    kind: AnalysisStatKind;
    value: number;
    label: string;
    className: string;
  }[] = [
    {
      kind: "modules",
      value: result.graph.nodes.length,
      label: "Modules",
      className: "stat",
    },
    {
      kind: "dependencies",
      value: result.graph.edges.length,
      label: "Dependencies",
      className: "stat",
    },
    {
      kind: "pass",
      value: result.validation.filter((v) => v.status === "pass").length,
      label: "Passed",
      className: "stat stat-pass",
    },
    {
      kind: "warn",
      value: result.validation.filter((v) => v.status === "warn").length,
      label: "Warnings",
      className: "stat stat-warn",
    },
    {
      kind: "fail",
      value: result.validation.filter((v) => v.status === "fail").length,
      label: "Failures",
      className: "stat stat-fail",
    },
  ];

  const validationHandlers: ValidationDetailHandlers = {
    onOpenFile: (target) => handlers.onOpenValidationTarget?.(target),
    onShowOnGraph: (target) => handlers.onShowValidationOnGraph?.(target),
    onShowCycleOnGraph: (cycle) => handlers.onShowCycleOnGraph?.(cycle),
    resolveSymbol: (file, line) => {
      const hierarchy = handlers.getHierarchy?.() ?? null;
      if (!hierarchy || line == null) return undefined;
      return findSymbolAtLine(hierarchy, file, line);
    },
  };

  for (const def of statDefs) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `${def.className} stat-clickable`;
    card.title = `View ${def.label.toLowerCase()} details`;

    const value = document.createElement("span");
    value.className = "stat-value";
    value.textContent = String(def.value);

    const label = document.createElement("span");
    label.className = "stat-label";
    label.textContent = def.label;

    card.append(value, label);
    card.addEventListener("click", () => {
      showAnalysisStatDetail(def.kind, result, {
        onShowModuleOnGraph: handlers.onShowModuleOnGraph,
        onShowDependencyOnGraph: handlers.onShowDependencyOnGraph,
        validation: validationHandlers,
      });
    });

    stats.appendChild(card);
  }

  container.appendChild(stats);
}

function renderValidationTab(
  container: HTMLElement,
  result: AnalysisResult,
  handlers: ResultsPanelHandlers,
): void {
  if (result.validation.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No validation rules were run";
    container.appendChild(empty);
    return;
  }

  for (const item of result.validation) {
    const cycleGroups = cycleGroupsFromValidation(item);
    const hasDetails = item.affected.length > 0 || cycleGroups.length > 0;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `validation-item validation-${item.status} validation-item-clickable`;
    row.disabled = !hasDetails;

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

    if (hasDetails) {
      const affected = document.createElement("div");
      affected.className = "validation-affected";
      if (cycleGroups.length > 0) {
        affected.textContent = `${cycleGroups.length} cycle group${cycleGroups.length === 1 ? "" : "s"} — click to view on graph`;
      } else {
        const fileCount = new Set(
          item.affected.map((a) => a.split(":")[0]),
        ).size;
        affected.textContent =
          fileCount === 1
            ? `1 file · ${item.affected.length} issue(s) — click to view`
            : `${fileCount} files · ${item.affected.length} issue(s) — click to view`;
      }
      body.appendChild(affected);
    }

    row.append(badge, body);

    if (hasDetails) {
      row.addEventListener("click", () => {
        const hierarchy = handlers.getHierarchy?.() ?? null;
        showValidationDetail(item, {
          onOpenFile: (target) => {
            handlers.onOpenValidationTarget?.(target);
          },
          onShowOnGraph: (target) => {
            handlers.onShowValidationOnGraph?.(target);
          },
          onShowCycleOnGraph: (cycle) => {
            handlers.onShowCycleOnGraph?.(cycle);
          },
          resolveSymbol: (file, line) => {
            if (!hierarchy || line == null) return undefined;
            return findSymbolAtLine(hierarchy, file, line);
          },
        });
      });
    }

    container.appendChild(row);
  }
}
