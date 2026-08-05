import type {
  AnalysisResult,
  HierarchyIndex,
  QualityIndex,
  RuleTaskProgress,
} from "../analysis/types";
import type { AnalysisRun } from "../analysis/manager";
import {
  buildArchitectureHealth,
  type ArchitectureHealthReport,
  type RatedEntity,
} from "../analysis/architectureHealth";
import { healthStatus } from "../analysis/dsm";
import {
  formatMetricHint,
  formatMetricPrimary,
  parsePercentileViewMode,
  PERCENTILE_VIEW_MODES,
  type PercentileViewMode,
} from "../analysis/percentileView";
import {
  analysisStatusCounts,
  formatAnalysisStatusSummary,
} from "../analysis/statusSummary";
import { renderAiStreamPreview } from "./aiStreamPreview";
import { mountScoreHistorySection } from "./scoreHistoryCharts";
import type { AnalysisScoreSnapshot } from "../analysis/scoreHistory";
import {
  attachMetricDefinitionToggle,
  metricInfoAffordance,
} from "./metricExplain";
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
import { createLoadingPlaceholder } from "./loadingPlaceholder";
import { renderPagedGrid } from "./pagedList";
import { t, type MessageKey } from "../i18n";

const PIPELINE_STAGE_KEYS: Record<string, MessageKey> = {
  scanning: "progress.stage.scanning",
  reading: "progress.stage.reading",
  lsp: "progress.stage.lsp",
  analyzing: "progress.stage.analyzing",
  validating: "progress.stage.validating",
  quality: "progress.stage.quality",
};

function pipelineStageLabel(stageId: string, fallback: string): string {
  const key = PIPELINE_STAGE_KEYS[stageId];
  return key ? t(key) : fallback;
}

function percentileModeLabel(mode: PercentileViewMode): string {
  switch (mode) {
    case "avg":
      return t("report.percentile.avg");
    case "p50":
      return t("report.percentile.p50");
    case "p80":
      return t("report.percentile.p80");
    case "p90":
      return t("report.percentile.p90");
    case "all":
      return t("report.percentile.all");
  }
}

function dsmLevelLabel(level: string): string {
  if (level === "package") return t("dsm.packages");
  if (level === "file") return t("dsm.files");
  return level;
}

function dsmOrderLabel(ordering: string): string {
  if (ordering === "partitioned") return t("dsm.partitioned");
  if (ordering === "hierarchical") return t("dsm.hierarchical");
  return ordering;
}

type TabId = "analysis" | "validation" | "progress";

export interface ResultsPanelHandlers {
  onOpenValidationTarget?: ValidationDetailHandlers["onOpenFile"];
  onShowValidationOnGraph?: ValidationDetailHandlers["onShowOnGraph"];
  onShowCycleOnGraph?: ValidationDetailHandlers["onShowCycleOnGraph"];
  onInstallGitleaks?: ValidationDetailHandlers["onInstallGitleaks"];
  onInstallTrufflehog?: ValidationDetailHandlers["onInstallTrufflehog"];
  onShowModuleOnGraph?: AnalysisDetailHandlers["onShowModuleOnGraph"];
  onOpenModuleFile?: AnalysisDetailHandlers["onOpenModuleFile"];
  onShowDependencyOnGraph?: AnalysisDetailHandlers["onShowDependencyOnGraph"];
  onShowDsm?: (highlightIds?: string[]) => void;
  getHierarchy?: () => HierarchyIndex | null;
  getPercentileView?: () => PercentileViewMode;
  onPercentileViewChange?: (mode: PercentileViewMode) => void;
  onCancelRun?: (id: string) => void;
  onCancelAllRuns?: () => void;
  onApplyRun?: (id: string) => void;
  /**
   * Slim analysis leaves `quality.files` empty. Load them when the Analysis tab
   * needs File ratings. Caller should update the result (e.g. setResult) when done.
   */
  onRequestQualityFiles?: () => Promise<QualityIndex | null>;
  /** Switch the main center view to the overall analysis report. */
  onRequestShowReport?: () => void;
  /** Switch the main center view to live analysis progress. */
  onRequestShowProgress?: () => void;
  /** Load score history for Report time-series charts. */
  getScoreHistory?: () => Promise<AnalysisScoreSnapshot[]>;
}

export interface ResultsPanelOptions {
  /**
   * When set, the Analysis overview renders in the main center view instead of
   * the bottom panel tabs.
   */
  reportHost?: HTMLElement;
  /**
   * When set, live Progress / AI stream renders in the main center view instead
   * of the bottom panel tabs.
   */
  progressHost?: HTMLElement;
}

export function createResultsPanel(
  container: HTMLElement,
  handlers: ResultsPanelHandlers = {},
  options: ResultsPanelOptions = {},
): {
  setResult: (result: AnalysisResult | null) => void;
  setRuns: (runs: AnalysisRun[]) => void;
  showTab: (tab: TabId) => void;
  refreshReport: () => void;
  refreshProgress: () => void;
} {
  const reportHost = options.reportHost ?? null;
  const reportInMainView = reportHost != null;
  const progressInMainView = options.progressHost != null;
  let activeTab: TabId = reportInMainView || progressInMainView ? "validation" : "analysis";
  let currentResult: AnalysisResult | null = null;
  let activeRuns: AnalysisRun[] = [];
  /** Tracks lazy quality.files fetch for Analysis → File ratings. */
  let qualityFilesLoad: "idle" | "loading" | "done" = "idle";
  let qualityFilesRequestId = 0;

  const tabs = document.createElement("div");
  tabs.className = "results-tabs";

  const tabDefs: { id: TabId; label: string; title: string }[] = [
    ...(reportInMainView
      ? []
      : [
          {
            id: "analysis" as const,
            label: t("results.tab.analysis"),
            title: t("results.tab.analysisTitle"),
          },
        ]),
    {
      id: "validation",
      label: t("results.tab.validation"),
      title: t("results.tab.validationTitle"),
    },
    ...(progressInMainView
      ? []
      : [
          {
            id: "progress" as const,
            label: t("tab.progress"),
            title: t("results.tab.progressTitle"),
          },
        ]),
  ];

  const tabButtons: Record<string, HTMLButtonElement> = {};

  function setActiveTab(tab: TabId): void {
    if (reportInMainView && tab === "analysis") {
      renderReport();
      handlers.onRequestShowReport?.();
      return;
    }
    if (progressInMainView && tab === "progress") {
      handlers.onRequestShowProgress?.();
      updateProgressRuns();
      return;
    }
    activeTab = tab;
    for (const [id, btn] of Object.entries(tabButtons)) {
      btn.classList.toggle("active", id === tab);
    }
    renderContent();
  }

  for (const def of tabDefs) {
    const btn = document.createElement("button");
    btn.className = "results-tab";
    btn.textContent = def.label;
    btn.title = def.title;
    btn.dataset.tab = def.id;
    if (def.id === activeTab) btn.classList.add("active");
    btn.addEventListener("click", () => {
      setActiveTab(def.id);
    });
    tabButtons[def.id] = btn;
    tabs.appendChild(btn);
  }

  const content = document.createElement("div");
  content.className = "results-content";

  const progressHost = options.progressHost ?? document.createElement("div");
  progressHost.classList.add("results-progress-content");
  if (progressInMainView) {
    progressHost.classList.add("analysis-progress-main");
  } else {
    progressHost.hidden = true;
  }

  const resultsHost = document.createElement("div");
  resultsHost.className = "results-tab-content";

  const emptyHost = document.createElement("div");
  emptyHost.className = "panel-empty";
  emptyHost.textContent = t("report.empty");
  emptyHost.hidden = true;

  if (progressInMainView) {
    content.append(resultsHost, emptyHost);
  } else {
    content.append(progressHost, resultsHost, emptyHost);
  }
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
    body: HTMLElement;
    progressCol: HTMLElement;
    streamCol: HTMLElement;
    message: HTMLElement;
    overallTrack: HTMLElement;
    overallFill: HTMLElement;
    overallMeta: HTMLElement;
    actions: HTMLElement;
    title: HTMLElement;
    toggleBtn: HTMLButtonElement;
    summary: HTMLElement;
    rulesHeading: HTMLElement | null;
    rulesList: HTMLElement | null;
    pipelineBars: Map<string, TaskBarRefs>;
    ruleBars: Map<string, TaskBarRefs>;
    aiStreamHost: HTMLElement | null;
    /** Last status used to build action buttons — skip rebuild when unchanged. */
    actionStatus: AnalysisRun["status"] | null;
  }

  const runCards = new Map<string, RunCardRefs>();
  /** Collapsed run cards — progress/AI body hidden until reopened. */
  const collapsedRunIds = new Set<string>();
  let runsHeadingEl: HTMLElement | null = null;
  let runsHeadingText: HTMLElement | null = null;
  let cancelAllBtn: HTMLButtonElement | null = null;
  let runsCardsHost: HTMLElement | null = null;
  let progressEmptyEl: HTMLElement | null = null;

  function statusIcon(status: RuleTaskProgress["status"]): string {
    if (status === "done") return "✓";
    if (status === "running") return "◐";
    if (status === "failed") return "✕";
    return "○";
  }

  function statusLabelText(status: RuleTaskProgress["status"]): string {
    if (status === "running") return t("progress.running");
    if (status === "done") return t("progress.done");
    if (status === "failed") return t("progress.failed");
    return t("progress.waiting");
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
    statusLabel.textContent = t("progress.waiting");

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

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn btn-ghost analysis-run-toggle";
    toggleBtn.setAttribute("aria-label", t("progress.expandCollapse"));

    const titleBlock = document.createElement("div");
    titleBlock.className = "analysis-run-title-block";

    const title = document.createElement("div");
    title.className = "analysis-run-title";
    title.textContent = run.label;

    const summary = document.createElement("div");
    summary.className = "analysis-run-summary";

    titleBlock.append(title, summary);

    const actions = document.createElement("div");
    actions.className = "analysis-run-actions";
    header.append(toggleBtn, titleBlock, actions);

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
    pipelineHeading.textContent = t("progress.pipeline");

    const pipelineList = document.createElement("div");
    pipelineList.className = "analysis-rule-tasks analysis-pipeline-tasks";

    const pipelineBars = new Map<string, TaskBarRefs>();
    for (const stage of getPipelineStages()) {
      const bar = createTaskBar(
        pipelineStageLabel(stage.id, stage.label),
        stage.id,
      );
      pipelineBars.set(stage.id, bar);
      pipelineList.appendChild(bar.row);
    }

    const body = document.createElement("div");
    body.className = "analysis-run-body";

    const progressCol = document.createElement("div");
    progressCol.className = "analysis-run-progress";
    progressCol.append(message, overallWrap, pipelineHeading, pipelineList);

    const streamCol = document.createElement("div");
    streamCol.className = "analysis-run-stream";
    streamCol.hidden = true;

    const aiStreamHost = document.createElement("div");
    aiStreamHost.className = "analysis-ai-stream-host";
    streamCol.appendChild(aiStreamHost);

    body.append(progressCol, streamCol);
    root.append(header, body);

    toggleBtn.addEventListener("click", () => {
      if (collapsedRunIds.has(run.id)) {
        collapsedRunIds.delete(run.id);
      } else {
        collapsedRunIds.add(run.id);
      }
      applyCollapsedState(run.id);
    });

    return {
      root,
      body,
      progressCol,
      streamCol,
      message,
      overallTrack,
      overallFill,
      overallMeta,
      actions,
      title,
      toggleBtn,
      summary,
      rulesHeading: null,
      rulesList: null,
      pipelineBars,
      ruleBars: new Map(),
      aiStreamHost,
      actionStatus: null,
    };
  }

  function applyCollapsedState(runId: string): void {
    const refs = runCards.get(runId);
    if (!refs) return;
    const collapsed = collapsedRunIds.has(runId);
    refs.root.classList.toggle("is-collapsed", collapsed);
    refs.body.hidden = collapsed;
    refs.toggleBtn.textContent = collapsed ? "▸" : "▾";
    refs.toggleBtn.title = collapsed
      ? t("progress.expand")
      : t("progress.collapse");
    refs.summary.hidden = !collapsed;
  }

  function runStatusSummary(run: AnalysisRun): string {
    if (run.status === "running") {
      const pct = overallProgressPercent(run.progress);
      return t("progress.runningSummary", {
        message: run.progress?.message ?? t("progress.runningEllipsis"),
        pct,
      });
    }
    if (run.status === "completed") return t("progress.completePct");
    if (run.status === "cancelled") return t("progress.cancelled");
    if (run.status === "failed") return run.error ?? t("progress.failed");
    return run.status;
  }

  function updateRunActions(refs: RunCardRefs, run: AnalysisRun): void {
    // Rebuild only when status changes (every progress tick used to recreate Cancel).
    if (refs.actionStatus === run.status) return;
    refs.actionStatus = run.status;
    refs.actions.replaceChildren();
    if (run.status === "running") {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-ghost analysis-run-cancel";
      cancelBtn.textContent = t("analysis.cancel");
      cancelBtn.addEventListener("click", () => handlers.onCancelRun?.(run.id));
      refs.actions.appendChild(cancelBtn);
      return;
    }
    if (run.status === "completed" && run.result) {
      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "btn btn-ghost analysis-run-apply";
      applyBtn.textContent = t("progress.showInWorkspace");
      applyBtn.title = t("progress.showInWorkspaceTitle");
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
      refs.progressCol.appendChild(refs.rulesHeading);
    }

    if (!refs.rulesList) {
      refs.rulesList = document.createElement("div");
      refs.rulesList.className = "analysis-rule-tasks";
      refs.progressCol.appendChild(refs.rulesList);
    }

    const runningCount = ruleTasks.filter((task) => task.status === "running").length;
    const doneCount = ruleTasks.filter(
      (task) => task.status === "done" || task.status === "failed",
    ).length;
    refs.rulesHeading.textContent =
      currentStage === "validating" || runningCount > 0
        ? t("progress.rulesRunning", {
            running: runningCount,
            done: doneCount,
            total: ruleTasks.length,
          })
        : t("progress.rulesDone", {
            done: doneCount,
            total: ruleTasks.length,
          });

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
    refs.title.textContent = run.label;
    refs.summary.textContent = runStatusSummary(run);
    updateRunActions(refs, run);
    applyCollapsedState(run.id);

    const progress = run.progress;
    const currentStage = progress?.stage ?? "starting";
    const ruleTasks =
      run.ruleTasks.length > 0
        ? run.ruleTasks
        : (progress?.ruleTasks ?? []);

    if (run.status === "failed") {
      refs.message.textContent = run.error ?? t("progress.analysisFailed");
    } else if (run.status === "cancelled") {
      refs.message.textContent = t("progress.cancelled");
    } else {
      refs.message.textContent = progress?.message ?? t("progress.preparing");
    }

    const pipelineFinished =
      run.status === "completed" ||
      progress?.stage === "done" ||
      (progress?.percent ?? 0) >= 100;
    const overallPct = pipelineFinished
      ? 100
      : overallProgressPercent(progress);
    refs.overallTrack.setAttribute("aria-valuenow", String(overallPct));
    refs.overallFill.style.width = `${overallPct}%`;
    refs.overallFill.className = "analysis-progress-fill";
    if (pipelineFinished) {
      refs.overallFill.classList.add("analysis-progress-fill-done");
    }

    if (run.status === "running" && progress?.stage === "done") {
      refs.overallMeta.textContent =
        progress.percent < 100 || /saving/i.test(progress.message)
          ? t("progress.finalizing")
          : t("progress.transferring");
      refs.overallMeta.hidden = false;
    } else if (run.status === "running" && progress) {
      refs.overallMeta.textContent = overallProgressMeta(progress);
      refs.overallMeta.hidden = false;
    } else if (run.status === "completed") {
      refs.overallMeta.textContent = t("progress.completePct");
      refs.overallMeta.hidden = false;
    } else {
      refs.overallMeta.hidden = true;
    }

    for (const stage of getPipelineStages()) {
      const bar = refs.pipelineBars.get(stage.id);
      if (!bar) continue;
      // Treat pipeline as fully done once stage is "done" even before run.status flips.
      const status = pipelineFinished
        ? "done"
        : pipelineStageStatus(currentStage, stage.id);
      const fill = pipelineFinished
        ? 100
        : pipelineStageFillPercent(currentStage, stage.id, progress);
      updateTaskBar(bar, status, fill);
    }

    syncRuleTaskBars(refs, ruleTasks, currentStage, progress);

    // Show the AI text box only once an AI validation stream has started.
    const hasAiConversation = Boolean(progress?.aiStream);
    refs.streamCol.hidden = !hasAiConversation;
    refs.root.classList.toggle("has-ai-stream", hasAiConversation);
    if (hasAiConversation) {
      if (!refs.aiStreamHost) {
        refs.aiStreamHost = document.createElement("div");
        refs.aiStreamHost.className = "analysis-ai-stream-host";
        refs.streamCol.appendChild(refs.aiStreamHost);
      }
      renderAiStreamPreview(refs.aiStreamHost, progress!.aiStream!);
    }
  }

  function updateProgressRuns(): void {
    const scrollRoot = progressInMainView ? progressHost : content;
    const savedRootScroll = scrollRoot.scrollTop;
    const savedColScroll = new Map<string, number>();
    const savedRulesScroll = new Map<string, number>();
    for (const [id, refs] of runCards) {
      savedColScroll.set(id, refs.progressCol.scrollTop);
      if (refs.rulesList) {
        savedRulesScroll.set(id, refs.rulesList.scrollTop);
      }
    }

    const orderedRuns = [...activeRuns].sort((a, b) => b.startedAt - a.startedAt);
    const runIds = new Set(orderedRuns.map((run) => run.id));
    const running = orderedRuns.filter((run) => run.status === "running");

    for (const [id, refs] of runCards) {
      if (!runIds.has(id)) {
        refs.root.remove();
        runCards.delete(id);
        collapsedRunIds.delete(id);
      }
    }

    if (orderedRuns.length === 0) {
      collapsedRunIds.clear();
      if (!progressEmptyEl) {
        progressEmptyEl = document.createElement("div");
        progressEmptyEl.className = "panel-empty";
        progressEmptyEl.textContent = t("progress.empty");
      }
      if (!progressHost.contains(progressEmptyEl)) {
        progressHost.replaceChildren(progressEmptyEl);
      }
      runsHeadingEl = null;
      runsHeadingText = null;
      cancelAllBtn = null;
      runsCardsHost = null;
      return;
    }

    progressEmptyEl?.remove();
    progressEmptyEl = null;

    if (!runsHeadingEl) {
      runsHeadingEl = document.createElement("div");
      runsHeadingEl.className = "analysis-runs-heading";
      runsHeadingText = document.createElement("span");
      runsHeadingText.className = "analysis-runs-heading-text";
      runsHeadingEl.appendChild(runsHeadingText);
      progressHost.appendChild(runsHeadingEl);
    }

    const runningCount = running.length;
    const finishedCount = orderedRuns.length - runningCount;
    if (runningCount > 0) {
      runsHeadingText!.textContent =
        (runningCount === 1
          ? t("progress.runsInProgressOne", { n: runningCount })
          : t("progress.runsInProgress", { n: runningCount })) +
        (finishedCount > 0
          ? t("progress.finishedSuffix", { n: finishedCount })
          : "");
    } else {
      runsHeadingText!.textContent =
        orderedRuns.length === 1
          ? t("progress.completedRunsOne", { n: orderedRuns.length })
          : t("progress.completedRuns", { n: orderedRuns.length });
    }

    if (runningCount > 1) {
      if (!cancelAllBtn) {
        cancelAllBtn = document.createElement("button");
        cancelAllBtn.type = "button";
        cancelAllBtn.className = "btn btn-ghost analysis-runs-cancel-all";
        cancelAllBtn.textContent = t("progress.cancelAll");
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
      progressHost.appendChild(runsCardsHost);
    }

    const newRunIds = orderedRuns
      .filter((run) => !runCards.has(run.id))
      .map((run) => run.id);
    if (newRunIds.length > 0) {
      // Newest run stays open; push older runs down and collapse them.
      for (const [id] of runCards) {
        collapsedRunIds.add(id);
      }
    }

    for (const run of orderedRuns) {
      let refs = runCards.get(run.id);
      if (!refs) {
        refs = createRunCard(run);
        runCards.set(run.id, refs);
      }
      updateRunCard(refs, run);
    }

    // Reorder only when needed — appendChild every tick was resetting scroll.
    const needsReorder = orderedRuns.some((run, index) => {
      const refs = runCards.get(run.id);
      return !refs || runsCardsHost!.children[index] !== refs.root;
    });
    if (needsReorder) {
      for (const run of orderedRuns) {
        const refs = runCards.get(run.id);
        if (refs) runsCardsHost.appendChild(refs.root);
      }
    }

    scrollRoot.scrollTop = savedRootScroll;
    for (const [id, refs] of runCards) {
      const colTop = savedColScroll.get(id);
      if (colTop != null) refs.progressCol.scrollTop = colTop;
      const rulesTop = savedRulesScroll.get(id);
      if (rulesTop != null && refs.rulesList) {
        refs.rulesList.scrollTop = rulesTop;
      }
    }
  }

  function analysisFileRatingsState() {
    return {
      filesHydrated: Object.keys(currentResult?.quality?.files ?? {}).length > 0,
      filesLoading: qualityFilesLoad === "loading",
      onNeedQualityFiles: () => {
        requestQualityFilesForRatings();
      },
    };
  }

  function renderReport(): void {
    if (!reportHost) return;
    reportHost.replaceChildren();
    if (!currentResult) {
      const empty = document.createElement("div");
      empty.className = "analysis-report-empty";
      empty.innerHTML = `
        <h2 class="analysis-report-title">${t("view.report")}</h2>
        <p class="panel-empty">${t("report.emptyBody")}</p>
      `;
      reportHost.appendChild(empty);
      return;
    }
    renderAnalysisTab(reportHost, currentResult, handlers, analysisFileRatingsState(), {
      asReport: true,
    });
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
        if (!reportInMainView) {
          renderAnalysisTab(resultsHost, currentResult, handlers, analysisFileRatingsState());
        }
        break;
      case "validation":
        renderValidationTab(resultsHost, currentResult, handlers);
        break;
    }
  }

  /** Only when the user opens File ratings — never on Analysis first paint. */
  function requestQualityFilesForRatings(): void {
    if (!handlers.onRequestQualityFiles || !currentResult) return;
    if (qualityFilesLoad === "loading") return;
    if (Object.keys(currentResult.quality?.files ?? {}).length > 0) {
      qualityFilesLoad = "done";
      return;
    }
    qualityFilesLoad = "loading";
    const requestId = qualityFilesRequestId;
    // Fetch on the next macrotask so the File tab can paint "Loading…" first.
    window.setTimeout(() => {
      void handlers
        .onRequestQualityFiles?.()
        .catch(() => null)
        .then(() => {
          if (requestId !== qualityFilesRequestId) return;
          qualityFilesLoad = "done";
          // Boot's setResult usually re-renders; fall back if quality was empty.
          if (Object.keys(currentResult?.quality?.files ?? {}).length === 0) {
            if (reportInMainView) renderReport();
            else if (activeTab === "analysis") renderContent();
          }
        });
    }, 0);
  }

  function renderContent(): void {
    if (reportInMainView) {
      renderReport();
    }
    if (progressInMainView) {
      updateProgressRuns();
    }

    const showProgress = !progressInMainView && activeTab === "progress";
    if (!progressInMainView) {
      progressHost.hidden = !showProgress;
    }
    resultsHost.hidden = showProgress;

    if (showProgress) {
      emptyHost.hidden = true;
      updateProgressRuns();
      return;
    }

    // Validation (and legacy Analysis) — never show progress bars or AI text channel.
    const hasRuns = activeRuns.length > 0;
    const hasRunning = activeRuns.some((run) => run.status === "running");
    emptyHost.hidden = hasRunning || hasRuns || currentResult !== null;
    renderResults();
  }

  return {
    setResult(result: AnalysisResult | null) {
      const prev = currentResult;
      currentResult = result;
      if (!result) {
        qualityFilesLoad = "idle";
        qualityFilesRequestId += 1;
      } else if (Object.keys(result.quality?.files ?? {}).length > 0) {
        qualityFilesLoad = "done";
      } else if (result !== prev) {
        // New analysis result without files — allow another lazy fetch.
        qualityFilesLoad = "idle";
        qualityFilesRequestId += 1;
      }
      renderContent();
    },
    setRuns(runs: AnalysisRun[]) {
      const prevById = new Map(activeRuns.map((run) => [run.id, run]));
      const startedNew = runs.some(
        (run) => run.status === "running" && !prevById.has(run.id),
      );
      const latest = runs.reduce<AnalysisRun | null>((best, run) => {
        if (!best || run.startedAt >= best.startedAt) return run;
        return best;
      }, null);
      const latestJustFinished =
        latest != null &&
        (latest.status === "completed" || latest.status === "failed") &&
        prevById.get(latest.id)?.status === "running";

      activeRuns = runs;
      if (startedNew) {
        if (progressInMainView) {
          updateProgressRuns();
          handlers.onRequestShowProgress?.();
          return;
        }
        setActiveTab("progress");
        return;
      }
      if (latestJustFinished && latest.status === "completed") {
        if (reportInMainView) {
          renderReport();
          handlers.onRequestShowReport?.();
          if (progressInMainView) updateProgressRuns();
          else setActiveTab("validation");
          return;
        }
        setActiveTab("analysis");
        return;
      }
      renderContent();
    },
    showTab(tab: TabId) {
      setActiveTab(tab);
    },
    refreshReport() {
      renderReport();
    },
    refreshProgress() {
      updateProgressRuns();
    },
  };
}

function renderAnalysisTab(
  container: HTMLElement,
  result: AnalysisResult,
  handlers: ResultsPanelHandlers,
  fileRatingsState: {
    filesHydrated: boolean;
    filesLoading: boolean;
    onNeedQualityFiles?: () => void;
  } = {
    filesHydrated: true,
    filesLoading: false,
  },
  opts: { asReport?: boolean } = {},
): void {
  const root = document.createElement("div");
  root.className = opts.asReport ? "analysis-report" : "analysis-panel";

  if (opts.asReport) {
    const title = document.createElement("h2");
    title.className = "analysis-report-title";
    title.textContent = t("view.report");
    root.appendChild(title);
  }

  const summary = document.createElement("div");
  summary.className = "result-summary";
  summary.textContent = formatAnalysisStatusSummary(result);
  root.appendChild(summary);

  const stats = document.createElement("div");
  stats.className = "result-stats";

  const counts = analysisStatusCounts(result);
  type StatDef = {
    value: number;
    label: string;
    className: string;
    kind?: AnalysisStatKind;
    onClick?: () => void;
    title?: string;
  };
  const statDefs: StatDef[] = [
    {
      value: counts.packages,
      label: t("report.stat.packages"),
      className: "stat",
      kind: "modules",
      title: t("report.stat.packagesTitle"),
    },
    {
      value: counts.files,
      label: t("report.stat.sourceFiles"),
      className: "stat",
      title: t("report.stat.sourceFilesTitle"),
    },
    {
      value: counts.rules,
      label: t("report.stat.rules"),
      className: "stat",
      title: t("report.stat.rulesTitle"),
    },
    {
      value: counts.passed,
      label: t("report.stat.passed"),
      className: "stat stat-pass",
      kind: "pass",
    },
    {
      value: counts.warnings,
      label: t("report.stat.warnings"),
      className: "stat stat-warn",
      kind: "warn",
    },
    {
      value: counts.failures,
      label: t("report.stat.failures"),
      className: "stat stat-fail",
      kind: "fail",
    },
    {
      value: counts.modularityHealth,
      label: t("scoreHistory.modularity"),
      className: "stat",
      onClick: () => {
        root
          .querySelector("#modularity-health-section")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
      title: t("report.stat.jumpModularity"),
    },
  ];

  const validationHandlers: ValidationDetailHandlers = {
    onOpenFile: (target) => handlers.onOpenValidationTarget?.(target),
    onShowOnGraph: (target) => handlers.onShowValidationOnGraph?.(target),
    onShowCycleOnGraph: (cycle) => handlers.onShowCycleOnGraph?.(cycle),
    onInstallGitleaks: () => handlers.onInstallGitleaks?.(),
    onInstallTrufflehog: () => handlers.onInstallTrufflehog?.(),
    resolveSymbol: (file, line) => {
      const hierarchy = handlers.getHierarchy?.() ?? null;
      if (!hierarchy || line == null) return undefined;
      return findSymbolAtLine(hierarchy, file, line);
    },
  };

  for (const def of statDefs) {
    const clickable = Boolean(def.kind || def.onClick);
    const card = document.createElement(clickable ? "button" : "div");
    if (clickable) (card as HTMLButtonElement).type = "button";
    card.className = clickable ? `${def.className} stat-clickable` : def.className;
    card.title =
      def.title ??
      (def.kind
        ? t("report.stat.viewDetails", { label: def.label.toLowerCase() })
        : def.label);

    const value = document.createElement("span");
    value.className = "stat-value";
    value.textContent = String(def.value);

    const label = document.createElement("span");
    label.className = "stat-label";
    label.textContent = def.label;

    card.append(value, label);
    if (def.kind) {
      card.addEventListener("click", () => {
        showAnalysisStatDetail(def.kind!, result, {
          onShowModuleOnGraph: handlers.onShowModuleOnGraph,
          onOpenModuleFile: handlers.onOpenModuleFile,
          onShowDependencyOnGraph: handlers.onShowDependencyOnGraph,
          validation: validationHandlers,
        });
      });
    } else if (def.onClick) {
      card.addEventListener("click", def.onClick);
    }

    stats.appendChild(card);
  }

  root.appendChild(stats);

  if (opts.asReport) {
    const overallSection = document.createElement("section");
    overallSection.className = "arch-health overall-health";
    const heading = document.createElement("h3");
    heading.className = "arch-health-heading";
    heading.textContent = t("scoreHistory.overall");
    overallSection.appendChild(heading);
    const overallChart = document.createElement("div");
    overallSection.appendChild(overallChart);
    mountScoreHistorySection(
      overallChart,
      "overall",
      handlers.getScoreHistory,
    );
    root.appendChild(overallSection);
  }

  const percentileView = parsePercentileViewMode(
    handlers.getPercentileView?.() ?? "all",
  );
  const archOpts = {
    modularityScore: result.dsm?.metrics.healthScore ?? null,
    percentileView,
  };
  // Summary only — rated entity lists hydrate when the user expands a section.
  const arch = buildArchitectureHealth(result.quality, {
    ...archOpts,
    includeEntityLists: false,
  });
  if (arch) {
    root.appendChild(
      renderArchitectureHealthSection(
        arch,
        (kind) =>
          buildArchitectureHealth(result.quality, {
            ...archOpts,
            includeEntityLists: true,
            // Rating every file is deferred until the File ratings tab needs it.
            includeFileLists: kind === "files",
          }),
        handlers,
        percentileView,
        () => {
          // Re-render Analysis report in place when percentile view changes.
          container.replaceChildren();
          renderAnalysisTab(
            container,
            result,
            handlers,
            fileRatingsState,
            opts,
          );
        },
        fileRatingsState,
        opts.asReport
          ? {
              mountHistory: (host) =>
                mountScoreHistorySection(
                  host,
                  "architecture",
                  handlers.getScoreHistory,
                ),
            }
          : undefined,
      ),
    );
  } else {
    const empty = document.createElement("div");
    empty.className = "panel-empty arch-health-empty";
    empty.textContent = t("report.architectureUnavailable");
    root.appendChild(empty);
  }

  root.appendChild(
    renderModularityHealthSection(
      result,
      handlers,
      opts.asReport
        ? {
            mountHistory: (host) =>
              mountScoreHistorySection(
                host,
                "modularity",
                handlers.getScoreHistory,
              ),
          }
        : undefined,
    ),
  );
  container.appendChild(root);
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
    btn.textContent = percentileModeLabel(option);
    btn.title =
      option === "all"
        ? t("report.percentile.allTitle")
        : option === "avg"
          ? t("report.percentile.avgTitle")
          : t("report.percentile.modeTitle", { mode: option });
    btn.addEventListener("click", () => {
      if (option !== mode) onChange(option);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

type RatingsSubtab = "packages" | "files";

function renderArchitectureHealthSection(
  arch: ArchitectureHealthReport,
  loadEntityLists: (
    kind: RatingsSubtab,
  ) => ArchitectureHealthReport | null,
  handlers: ResultsPanelHandlers,
  percentileView: PercentileViewMode,
  onRerender: () => void,
  fileRatingsState: {
    filesHydrated: boolean;
    filesLoading: boolean;
    onNeedQualityFiles?: () => void;
  } = {
    filesHydrated: true,
    filesLoading: false,
  },
  chartOpts?: { mountHistory?: (host: HTMLElement) => void },
): HTMLElement {
  const cachedLists: Partial<
    Record<RatingsSubtab, ArchitectureHealthReport | null>
  > = {};
  const entityReport = (kind: RatingsSubtab): ArchitectureHealthReport | null => {
    if (cachedLists[kind] === undefined) {
      cachedLists[kind] = loadEntityLists(kind);
    }
    return cachedLists[kind] ?? null;
  };

  const section = document.createElement("section");
  section.className = "arch-health";

  const headingRow = document.createElement("div");
  headingRow.className = "arch-health-heading-row";

  const heading = document.createElement("h3");
  heading.className = "arch-health-heading";
  heading.textContent = t("scoreHistory.architecture");
  headingRow.appendChild(heading);

  headingRow.appendChild(
    renderPercentileViewSwitch(percentileView, (mode) => {
      handlers.onPercentileViewChange?.(mode);
      onRerender();
    }),
  );
  section.appendChild(headingRow);

  const status = healthStatus(arch.rating);
  const scorecard = document.createElement("div");
  scorecard.className = `health-scorecard health-${status}`;

  const viewLabel =
    percentileView === "all"
      ? t("report.architectureLabel")
      : t("report.architectureWithView", {
          view: percentileModeLabel(percentileView),
        });
  const scoreEl = document.createElement("div");
  scoreEl.className = "health-score";
  scoreEl.innerHTML = `<span class="health-score-value">${arch.rating}</span><span class="health-score-label">${t("report.scoreOutOf", { label: viewLabel })}</span>`;

  const statusEl = document.createElement("div");
  statusEl.className = "health-status-label";
  const modBit =
    arch.modularityScore != null
      ? t("report.health.modularityBit", { score: arch.modularityScore })
      : "";
  statusEl.textContent =
    status === "healthy"
      ? t("report.health.healthy", { n: arch.packageCount, mod: modBit })
      : status === "fair"
        ? t("report.health.fair", { mod: modBit })
        : t("report.health.poor", { mod: modBit });

  scorecard.append(scoreEl, statusEl);
  section.appendChild(scorecard);

  if (chartOpts?.mountHistory) {
    const historyHost = document.createElement("div");
    section.appendChild(historyHost);
    chartOpts.mountHistory(historyHost);
  }

  const meta = document.createElement("div");
  meta.className = "arch-health-meta";
  meta.textContent = t("report.archMeta", {
    files: arch.fileCount.toLocaleString(),
    loc: arch.totalLoc.toLocaleString(),
  });
  section.appendChild(meta);

  const metrics = document.createElement("div");
  metrics.className = "health-metrics arch-health-metrics";
  for (const row of arch.metrics) {
    const item = document.createElement("div");
    item.className = "health-metric";
    item.title = row.detail;
    const digits = row.unit === "/kLOC" ? 1 : 0;
    const asPercent = row.id === "coverage";
    const primary = formatMetricPrimary(
      row.avg,
      row.percentiles,
      percentileView,
      digits,
      asPercent,
    );
    const hint = formatMetricHint(
      row.avg,
      row.percentiles,
      percentileView,
      digits,
    );
    const unit = row.unit
      ? ` <span class="arch-health-unit">${row.unit}</span>`
      : "";
    const labelSuffix =
      percentileView !== "avg" && percentileView !== "all"
        ? ` · ${percentileView}`
        : "";
    const labelEl = document.createElement("div");
    labelEl.className = "health-metric-label";
    const labelText = document.createElement("span");
    labelText.textContent = `${row.label}${labelSuffix}`;
    labelEl.append(labelText, metricInfoAffordance());

    const valueEl = document.createElement("div");
    valueEl.className = "health-metric-value";
    valueEl.innerHTML = `${primary}${unit}`;

    item.append(labelEl, valueEl);
    if (hint) {
      const hintEl = document.createElement("div");
      hintEl.className = "health-metric-hint";
      hintEl.textContent = hint;
      item.appendChild(hintEl);
    }
    attachMetricDefinitionToggle(item, row.id, {
      listRoot: metrics,
      label: row.label,
      displayValue: row.unit ? `${primary} ${row.unit}` : primary,
      measuredDetail: row.detail,
    });
    metrics.appendChild(item);
  }
  section.appendChild(metrics);
  section.appendChild(
    renderRatingsSubtabs(arch, entityReport, handlers, fileRatingsState),
  );

  return section;
}

/** good→worse = high rating first; worse→good = low rating first. */
type RatingsSort = "best-first" | "worst-first";

function sortRatedEntities(
  items: RatedEntity[],
  sort: RatingsSort,
): RatedEntity[] {
  const copy = items.slice();
  copy.sort((a, b) =>
    sort === "best-first" ? b.rating - a.rating : a.rating - b.rating,
  );
  return copy;
}

function renderRatingsSubtabs(
  arch: ArchitectureHealthReport,
  entityReport: (kind: RatingsSubtab) => ArchitectureHealthReport | null,
  handlers: ResultsPanelHandlers,
  fileRatingsState: {
    filesHydrated: boolean;
    filesLoading: boolean;
    onNeedQualityFiles?: () => void;
  },
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "arch-ratings";

  const toolbar = document.createElement("div");
  toolbar.className = "arch-ratings-toolbar";

  const tabs = document.createElement("div");
  tabs.className = "arch-ratings-subtabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", t("report.ratings"));

  const sortSwitch = document.createElement("div");
  sortSwitch.className = "arch-ratings-sort";
  sortSwitch.setAttribute("role", "group");
  sortSwitch.setAttribute("aria-label", t("report.ratingsSort"));

  const panel = document.createElement("div");
  panel.className = "arch-ratings-panel";

  let active: RatingsSubtab = "packages";
  let sort: RatingsSort = "best-first";
  const tabBtns = new Map<RatingsSubtab, HTMLButtonElement>();
  const sortBtns = new Map<RatingsSort, HTMLButtonElement>();

  const loadSorted = (id: RatingsSubtab): RatedEntity[] => {
    const report = entityReport(id);
    const raw =
      id === "packages" ? (report?.packages ?? []) : (report?.files ?? []);
    return sortRatedEntities(raw, sort);
  };

  const syncSortButtons = (): void => {
    for (const [key, btn] of sortBtns) {
      btn.classList.toggle("active", key === sort);
      btn.setAttribute("aria-pressed", key === sort ? "true" : "false");
    }
  };

  const paintTab = (id: RatingsSubtab): void => {
    active = id;
    for (const [key, btn] of tabBtns) {
      const on = key === id;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    }
    panel.replaceChildren();

    if (id === "files" && !fileRatingsState.filesHydrated) {
      if (!fileRatingsState.filesLoading) {
        fileRatingsState.filesLoading = true;
        fileRatingsState.onNeedQualityFiles?.();
      }
      const loading = createLoadingPlaceholder({
        title: t("report.loadingFileRatings"),
        detail: t("report.loadingFileRatingsDetail"),
        size: "fill",
      });
      loading.classList.add("arch-ratings-loading");
      panel.appendChild(loading);
      return;
    }

    const host = document.createElement("div");
    panel.appendChild(host);

    // Defer heavy file rating work so the tab chrome paints first.
    if (id === "files" && fileRatingsState.filesHydrated) {
      host.appendChild(
        createLoadingPlaceholder({
          title: t("report.computingFileRatings"),
          detail: t("report.computingFileRatingsDetail"),
          size: "fill",
        }),
      );
      requestAnimationFrame(() => {
        if (active !== "files") return;
        host.replaceChildren();
        renderPagedGrid(
          host,
          () => loadSorted("files"),
          (item) => renderRatingGridCard(item, handlers),
          {
            pageSize: 24,
            emptyText: t("report.noFileRatings"),
            className: "arch-ratings-grid",
          },
        );
      });
      return;
    }

    renderPagedGrid(
      host,
      () => loadSorted(id),
      (item) => renderRatingGridCard(item, handlers),
      {
        pageSize: 24,
        emptyText:
          id === "packages"
            ? t("report.noPackageRatings")
            : t("report.noFileRatings"),
        className: "arch-ratings-grid",
      },
    );
  };

  const defs: Array<{ id: RatingsSubtab; label: string; count: number }> = [
    {
      id: "packages",
      label: t("report.packageRatings"),
      count: arch.packageCount,
    },
    { id: "files", label: t("report.fileRatings"), count: arch.fileCount },
  ];

  for (const def of defs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "arch-ratings-subtab";
    btn.setAttribute("role", "tab");
    btn.textContent = t("report.ratingsCount", {
      label: def.label,
      count: def.count.toLocaleString(),
    });
    btn.addEventListener("click", () => {
      if (active !== def.id) paintTab(def.id);
    });
    tabBtns.set(def.id, btn);
    tabs.appendChild(btn);
  }

  const sortDefs: Array<{ id: RatingsSort; label: string; title: string }> = [
    {
      id: "best-first",
      label: t("report.sort.bestFirst"),
      title: t("report.sort.bestFirstTitle"),
    },
    {
      id: "worst-first",
      label: t("report.sort.worstFirst"),
      title: t("report.sort.worstFirstTitle"),
    },
  ];

  for (const def of sortDefs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "arch-ratings-sort-btn";
    btn.textContent = def.label;
    btn.title = def.title;
    btn.addEventListener("click", () => {
      if (sort === def.id) return;
      sort = def.id;
      syncSortButtons();
      paintTab(active);
    });
    sortBtns.set(def.id, btn);
    sortSwitch.appendChild(btn);
  }

  toolbar.append(tabs, sortSwitch);
  wrap.append(toolbar, panel);
  syncSortButtons();
  paintTab("packages");
  return wrap;
}

function renderRatingGridCard(
  item: RatedEntity,
  handlers: ResultsPanelHandlers,
): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `arch-rating-card arch-rating-${item.band}`;
  const opensFile = item.kind === "file";
  card.title = opensFile
    ? t("report.showOnGraph", { path: item.path })
    : t("report.showOnGraphDetails", { path: item.path });

  const score = document.createElement("span");
  score.className = "arch-rating-card-score";
  score.textContent = `${item.rating}`;

  const scoreUnit = document.createElement("span");
  scoreUnit.className = "arch-rating-card-score-unit";
  scoreUnit.textContent = "/100";

  const scoreWrap = document.createElement("div");
  scoreWrap.className = "arch-rating-card-score-wrap";
  scoreWrap.append(score, scoreUnit);

  const name = document.createElement("span");
  name.className = "arch-rating-card-name";
  name.textContent = item.label;

  const path = document.createElement("span");
  path.className = "arch-rating-card-path";
  path.textContent = item.path;

  card.append(scoreWrap, name, path);
  card.addEventListener("click", () => {
    handlers.onShowModuleOnGraph?.(item.path);
  });
  return card;
}

/** DSM modularity health — Analysis tab subsection (same chrome as Architecture health). */
function renderModularityHealthSection(
  result: AnalysisResult,
  handlers: ResultsPanelHandlers,
  chartOpts?: { mountHistory?: (host: HTMLElement) => void },
): HTMLElement {
  const section = document.createElement("section");
  section.className = "arch-health modularity-health";
  section.id = "modularity-health-section";

  const headingRow = document.createElement("div");
  headingRow.className = "arch-health-heading-row";

  const heading = document.createElement("h3");
  heading.className = "arch-health-heading";
  heading.textContent = t("scoreHistory.modularity");
  headingRow.appendChild(heading);
  section.appendChild(headingRow);

  const dsm = result.dsm ?? null;
  if (!dsm || dsm.elements.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty arch-health-empty";
    empty.textContent = t("report.modularityEmpty");
    section.appendChild(empty);

    if (chartOpts?.mountHistory) {
      const historyHost = document.createElement("div");
      section.appendChild(historyHost);
      chartOpts.mountHistory(historyHost);
    }

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn btn-ghost";
    openBtn.textContent = t("report.openDsm");
    openBtn.title = t("report.openDsmTitle");
    openBtn.addEventListener("click", () => handlers.onShowDsm?.());
    section.appendChild(openBtn);
    return section;
  }

  const score = Math.round(dsm.metrics.healthScore);
  const status = healthStatus(dsm.metrics.healthScore);

  const scorecard = document.createElement("div");
  scorecard.className = `health-scorecard health-${status}`;

  const scoreEl = document.createElement("div");
  scoreEl.className = "health-score";
  scoreEl.innerHTML = `<span class="health-score-value">${score}</span><span class="health-score-label">${t("report.scoreOutOf", { label: t("report.dsmModularity") })}</span>`;

  const statusEl = document.createElement("div");
  statusEl.className = "health-status-label";
  statusEl.textContent =
    status === "healthy"
      ? t("report.modHealthy")
      : status === "fair"
        ? t("report.modFair")
        : t("report.modPoor");

  scorecard.append(scoreEl, statusEl);
  section.appendChild(scorecard);

  if (chartOpts?.mountHistory) {
    const historyHost = document.createElement("div");
    section.appendChild(historyHost);
    chartOpts.mountHistory(historyHost);
  }

  const meta = document.createElement("div");
  meta.className = "arch-health-meta";
  meta.textContent = t("report.matrixMeta", {
    n: dsm.elements.length,
    level: dsmLevelLabel(dsm.level),
    order: dsmOrderLabel(dsm.ordering),
  });
  section.appendChild(meta);

  const metrics = document.createElement("div");
  metrics.className = "health-metrics arch-health-metrics";

  const metricRows: {
    id: string;
    label: string;
    value: string;
    hint: string;
  }[] = [
    {
      id: "cycles",
      label: t("report.metric.cycles"),
      value: String(dsm.metrics.cycleCount),
      hint: t("report.metric.cyclesHint", { n: dsm.metrics.nodesInCycles }),
    },
    {
      id: "upperTriangle",
      label: t("report.metric.upperTriangle"),
      value: `${(dsm.metrics.upperTriangleDensity * 100).toFixed(1)}%`,
      hint: t("report.metric.upperTriangleHint"),
    },
    {
      id: "coupling",
      label: t("report.metric.coupling"),
      value: `${(dsm.metrics.couplingDensity * 100).toFixed(1)}%`,
      hint: t("report.metric.couplingHint"),
    },
    {
      id: "propagation",
      label: t("report.metric.propagation"),
      value: `${(dsm.metrics.propagationCost * 100).toFixed(1)}%`,
      hint: t("report.metric.propagationHint"),
    },
    {
      id: "clustered",
      label: t("report.metric.clustered"),
      value: `${(dsm.metrics.clusteredCostNormalized * 100).toFixed(1)}%`,
      hint: t("report.metric.clusteredHint", {
        abs: Math.round(dsm.metrics.clusteredCost ?? 0),
      }),
    },
    {
      id: "buses",
      label: t("report.metric.buses"),
      value: String(dsm.metrics.busCount ?? dsm.busIds?.length ?? 0),
      hint: t("report.metric.busesHint"),
    },
  ];

  for (const row of metricRows) {
    const item = document.createElement("div");
    item.className = "health-metric";
    item.title = row.hint;

    const labelEl = document.createElement("div");
    labelEl.className = "health-metric-label";
    const labelText = document.createElement("span");
    labelText.textContent = row.label;
    labelEl.append(labelText, metricInfoAffordance());

    const valueEl = document.createElement("div");
    valueEl.className = "health-metric-value";
    valueEl.textContent = row.value;

    const hintEl = document.createElement("div");
    hintEl.className = "health-metric-hint";
    hintEl.textContent = row.hint;

    item.append(labelEl, valueEl, hintEl);
    attachMetricDefinitionToggle(item, row.id, {
      listRoot: section,
      label: row.label,
      displayValue: row.value,
      measuredDetail: row.hint,
    });
    metrics.appendChild(item);
  }
  section.appendChild(metrics);

  // Make the modularity scorecard clickable for the blended health formula.
  scorecard.classList.add("metric-has-def");
  scorecard.title = t("metric.clickForDef");
  attachMetricDefinitionToggle(scorecard, "modularityHealth", {
    listRoot: section,
    label: t("scoreHistory.modularity"),
    displayValue: `${score}/100`,
    measuredDetail: statusEl.textContent ?? undefined,
  });

  const violations = dsm.violations ?? [];
  if (violations.length > 0) {
    const conf = document.createElement("div");
    conf.className = "health-conformance";
    conf.innerHTML = `<strong>${t("report.ldmConformance")}:</strong> ${t("report.violationsCount", { n: violations.length })}`;
    section.appendChild(conf);
  } else if (
    result.validation.some((v) => v.rule_id === "architecture_conformance")
  ) {
    const conf = document.createElement("div");
    conf.className = "health-conformance health-conformance-ok";
    conf.textContent = t("report.ldmOk");
    section.appendChild(conf);
  }

  const actions = document.createElement("div");
  actions.className = "health-actions";

  const showDsmBtn = document.createElement("button");
  showDsmBtn.type = "button";
  showDsmBtn.className = "btn btn-ghost";
  showDsmBtn.textContent = t("report.showInDsm");
  showDsmBtn.addEventListener("click", () =>
    handlers.onShowDsm?.(dsm.cycleNodes),
  );
  actions.appendChild(showDsmBtn);

  if (violations.length > 0) {
    const showViol = document.createElement("button");
    showViol.type = "button";
    showViol.className = "btn btn-ghost";
    showViol.textContent = t("report.showViolationsInDsm");
    const ids = [...new Set(violations.flatMap((v) => [v.from, v.to]))];
    showViol.addEventListener("click", () => handlers.onShowDsm?.(ids));
    actions.appendChild(showViol);
  }

  const circular = result.validation.find(
    (v) => v.rule_id === "circular_dependencies",
  );
  const cycles = circular ? cycleGroupsFromValidation(circular) : [];
  if (cycles.length === 0 && dsm.cycleNodes.length > 0) {
    cycles.push({
      kind: dsm.level === "file" ? "file_imports" : "package_imports",
      nodes: dsm.cycleNodes.slice(0, 16),
      path: dsm.cycleNodes.slice(0, 16),
      label: t("report.dsmCycles"),
      node_count: dsm.cycleNodes.length,
    });
  }

  if (cycles.length > 0) {
    const showCycleBtn = document.createElement("button");
    showCycleBtn.type = "button";
    showCycleBtn.className = "btn btn-ghost";
    showCycleBtn.textContent = t("report.showCyclesOnGraph");
    showCycleBtn.addEventListener("click", () => {
      handlers.onShowCycleOnGraph?.(cycles[0]!);
    });
    actions.appendChild(showCycleBtn);
  }

  section.appendChild(actions);
  return section;
}

function renderValidationTab(
  container: HTMLElement,
  result: AnalysisResult,
  handlers: ResultsPanelHandlers,
): void {
  if (result.validation.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = t("validation.empty");
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
        affected.textContent =
          cycleGroups.length === 1
            ? t("validation.cycleGroupsOne")
            : t("validation.cycleGroups", { n: cycleGroups.length });
      } else {
        const fileCount = new Set(
          item.affected.map((a) => a.split(":")[0]),
        ).size;
        affected.textContent =
          fileCount === 1
            ? t("validation.issuesOneFile", { n: item.affected.length })
            : t("validation.issuesFiles", {
                files: fileCount,
                n: item.affected.length,
              });
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
          onInstallGitleaks: () => {
            handlers.onInstallGitleaks?.();
          },
          onInstallTrufflehog: () => {
            handlers.onInstallTrufflehog?.();
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
