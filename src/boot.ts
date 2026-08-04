import { computeLayout, parseLayoutMode, type LayoutMode } from "./wasm-bridge";
import { render, createRenderState, type RenderState } from "./canvas/renderer";
import { attachInteraction } from "./canvas/interaction";
import { fitCameraToContent, focusCameraOnNodeAnimated, focusCameraOnNodesAnimated } from "./canvas/camera";
import {
  animateLayoutTransition,
  animateVisibilityTransition,
} from "./canvas/layoutTransition";
import { parseEdgeStyle, type EdgeStyle } from "./canvas/edgeStyle";
import type { Graph, GraphEdge, GraphNode } from "./graph/types";
import {
  parseModuleFilters,
  visibleIdsForFilters,
  type ModuleFilterFlags,
} from "./graph/moduleFilters";
import {
  allLanguageFiltersEnabled,
  buildLanguageIndex,
  parseLanguageFilters,
  presentLanguages,
  visibleIdsForLanguageFilters,
  type LanguageFilterFlags,
} from "./graph/languages";
import { hierarchyFromGraph } from "./graph/hierarchy";
import type { AnalysisResult, CycleGroup } from "./analysis/types";
import { mergeRuleSettings, type RuleSettingsMap } from "./analysis/types";
import { isGitleaksMissingMessage } from "./gitleaks/types";
import { isTrufflehogMissingMessage } from "./trufflehog/types";
import { createAnalysisManager } from "./analysis/manager";
import type { LlmProviderInfo } from "./agent/types";
import type { LlmConfiguration, AiValidationRuntimeSettings } from "./validation/aiValidation";
import {
  migratePersistedAiSettings,
  migrateRuntimeSettings,
} from "./validation/aiValidation";
import { mergeLspSettings, type LspSettingsMap } from "./lsp/types";
import { ensureLinterSettings, type LinterSettingsMap } from "./linter/types";
import type { ProjectScan } from "./project/types";
import {
  getLlmProviders,
  openProjectDialog,
  scanProject,
  listProjectChildren,
  readProjectFile,
  writeProjectFile,
  listLspServers as fetchLspServers,
  installLspServer as runInstallLspServer,
  listLlmModels,
  probeCliLlmBackend,
  listLanguageLinters,
  installLinter,
  getGitleaksStatus,
  installGitleaks,
  getTrufflehogStatus,
  installTrufflehog,
  startAnalysisWatch,
  stopAnalysisWatch,
  startAnalysisSchedule,
  stopAnalysisSchedule,
  listenAnalysisTriggers,
} from "./project/api";
import { renderProjectTree } from "./ui/projectTree";
import { renderModulesList, type ModulesListState } from "./ui/modulesList";
import { createRulesPanel, type RulesPanelState, type RulesPanelContext } from "./ui/rulesPanel";
import {
  createLspServersPanel,
  type LspServersPanelState,
} from "./ui/lspServersPanel";
import {
  createLintersPanel,
  type LintersPanelState,
} from "./ui/lintersPanel";
import { createResultsPanel } from "./ui/resultsPanel";
import { createDsmView } from "./ui/dsmView";
import { createDesignRulesPanel } from "./ui/designRulesPanel";
import { computeDsm } from "./analysis/dsm";
import {
  checkDesignRules,
  collectDesignRulePackageIds,
  designRulesValidationItem,
  suggestLayersFromPartition,
  type DesignRule,
} from "./analysis/designRules";
import { defaultDesignRules } from "./analysis/designRules";
import { createLlmProviderConfigsPanel } from "./ui/llmProviderConfigsPanel";
import { createLlmRuntimeSettingsPanel } from "./ui/llmRuntimeSettingsPanel";
import { createLazyFileViewer } from "./lazy/fileViewer";
import { mountToolbarIcons } from "./ui/toolbar";
import { createSettingsPanel } from "./ui/settingsPanel";
import { initResizers } from "./ui/resizer";
import { showAnalysisDialog } from "./ui/analysisDialog";
import { showMessageDialog, splitInstallReport } from "./ui/messageDialog";
import { hideFlowOverlay, renderFlowOverlay } from "./ui/flowOverlay";
import { showSetupWizard } from "./ui/setupWizard";
import {
  defaultAnalysisTriggerConfig,
  type AnalysisTriggerConfig,
} from "./analysis/triggers";
import { initTooltips } from "./ui/tooltip";
import { hideGraphPopup, isGraphPopupOpen } from "./ui/graphPopup";
import { createModuleDetailsPanel } from "./ui/moduleDetailsPanel";
import { renderGraphNav, renderBreadcrumbBar, clearBreadcrumbBar } from "./ui/graphNav";
import {
  autoAdvanceSingleFolder,
  canGoBack,
  canGoForward,
  drillTargetForNode,
  goBack,
  goForward,
  graphForNavigation,
  hasStaleImportIndex,
  isDrillableNode,
  navigateTo,
  rootNavigation,
  serializeNavigation,
  type GraphNavigation,
} from "./graph/navigation";
import {
  findSymbolAtLine,
  navigationShowingFile,
  navigationToFile,
  navigationToPackageFile,
  type ValidationNavTarget,
} from "./validation/navigation";
import { isOpenableValidationPath, splitPathAndLocation } from "./validation/parseAffected";
import { renderFileNav } from "./ui/fileNav";
import { collectFileIssues } from "./validation/fileIssues";
import { hideValidationDetail } from "./ui/validationDetailPopup";
import { hideAnalysisStatDetail } from "./ui/analysisDetailPopup";
import {
  cycleHighlightFromPlan,
  planCycleGraphView,
} from "./validation/cycles";
import type { HierarchyIndex } from "./analysis/types";
import type { PersistedAppState, PersistedUiState } from "./state/types";
import {
  appendScoreHistorySnapshot,
  loadPersistedAnalysisMeta,
  loadPersistedAnalysisQuality,
  loadPersistedUiState,
  loadScoreHistory,
  scheduleSaveAnalysis,
  scheduleSaveUiState,
  saveUiStateNow,
} from "./state/store";
import {
  applyDomTranslations,
  initLocale,
  onLocaleChange,
  t,
  type Locale,
} from "./i18n";
import { createLanguagePanel } from "./i18n/languagePanel";
import type { AnalysisScoreSnapshot } from "./analysis/scoreHistory";
import {
  parsePercentileViewMode,
  type PercentileViewMode,
} from "./analysis/percentileView";
import { applyPanelSizes, readPanelSizes } from "./state/panels";
import { runWhenIdle, runWhenIdleAsync } from "./lazy/defer";
import { loadAnalysisRules } from "./lazy/rules";
import { clearHierarchyLoadCache, loadAnalysisHierarchy } from "./lazy/hierarchy";
import {
  clearQualityLoadCache,
  loadAnalysisQualityWithFiles,
} from "./lazy/quality";

interface AppState {
  projectPath: string | null;
  projectScan: ProjectScan | null;
  selectedRules: Set<string>;
  ruleSettings: RuleSettingsMap;
  lspSettings: LspSettingsMap;
  linterSettings: LinterSettingsMap;
  llmConfigurations: LlmConfiguration[];
  aiValidationRuntime: AiValidationRuntimeSettings;
  analysisTriggers: AnalysisTriggerConfig;
  llmProviders: LlmProviderInfo[];
  analysisResult: AnalysisResult | null;
  hierarchy: HierarchyIndex | null;
  graphNavigation: GraphNavigation;
  renderState: RenderState | null;
  modulesListState: ModulesListState;
  hierarchyLoading: boolean;
  dsmLevel: "package" | "file";
  dsmOrdering: "partitioned" | "hierarchical";
  designRules: DesignRule[];
  centerView: "report" | "progress" | "graph" | "dsm" | "file";
}

function hierarchyIsHydrated(hierarchy: HierarchyIndex | null | undefined): boolean {
  return Boolean(
    hierarchy && (hierarchy.files.length > 0 || hierarchy.packages.length > 0),
  );
}

export async function startApp(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#graph-canvas")!;
  const ctx = canvas.getContext("2d")!;

  const btnOpen = document.querySelector<HTMLButtonElement>("#btn-open-project")!;
  const btnRun = document.querySelector<HTMLButtonElement>("#btn-run-analysis")!;
  const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop-analysis")!;
  const btnSaveFile = document.querySelector<HTMLButtonElement>("#btn-save-file")!;
  const btnSettings = document.querySelector<HTMLButtonElement>("#btn-settings")!;
  const btnSetupWizard = document.querySelector<HTMLButtonElement>("#btn-setup-wizard");
  const btnSetupGuide = document.querySelector<HTMLButtonElement>("#btn-setup-guide");
  const projectPathEl = document.querySelector<HTMLElement>("#project-path")!;
  const treeContainer = document.querySelector<HTMLElement>("#project-tree")!;
  const modulesContainer = document.querySelector<HTMLElement>("#modules-list")!;
  const rulesContainer = document.querySelector<HTMLElement>("#rules-panel")!;
  const lspServersContainer = document.querySelector<HTMLElement>("#lsp-servers-panel")!;
  const lintersContainer = document.querySelector<HTMLElement>("#linters-panel")!;
  const settingsPanel = document.querySelector<HTMLElement>("#right-panel")!;
  const resultsContainer = document.querySelector<HTMLElement>("#results-panel")!;
  const llmProviderConfigsContainer = document.querySelector<HTMLElement>(
    "#llm-provider-configs-panel",
  )!;
  const llmRuntimeSettingsContainer = document.querySelector<HTMLElement>(
    "#llm-runtime-settings-panel",
  )!;
  const designRulesContainer = document.querySelector<HTMLElement>(
    "#design-rules-panel",
  )!;
  const languagePanelContainer = document.querySelector<HTMLElement>(
    "#language-panel",
  )!;
  const graphOverlay = document.querySelector<HTMLElement>("#graph-overlay")!;
  const fileViewerEl = document.querySelector<HTMLElement>("#file-viewer")!;
  const dsmViewEl = document.querySelector<HTMLElement>("#dsm-view")!;
  const analysisReportViewEl = document.querySelector<HTMLElement>(
    "#analysis-report-view",
  )!;
  const analysisProgressViewEl = document.querySelector<HTMLElement>(
    "#analysis-progress-view",
  )!;
  const graphNavContainer = document.querySelector<HTMLElement>("#graph-nav")!;
  const breadcrumbBar = document.querySelector<HTMLElement>("#breadcrumb-bar")!;
  clearBreadcrumbBar(breadcrumbBar);
  const viewTabs = document.querySelector<HTMLElement>("#view-tabs")!;
  const moduleDetailsPanelEl =
    document.querySelector<HTMLElement>("#module-details-panel")!;

  const persisted = await loadPersistedUiState();
  let uiLocale: Locale = initLocale(persisted.uiLocale);
  applyPanelSizes(persisted.panelSizes);

  const initialLinterSettings = ensureLinterSettings(persisted.linterSettings);
  let layoutMode: LayoutMode = parseLayoutMode(persisted.layoutMode);
  let moduleFilters: ModuleFilterFlags = parseModuleFilters(persisted.moduleFilters);
  let languageFilters: LanguageFilterFlags = parseLanguageFilters(
    persisted.languageFilters,
  );
  let edgeStyle: EdgeStyle = parseEdgeStyle(persisted.edgeStyle);
  let percentileView: PercentileViewMode = parsePercentileViewMode(
    persisted.percentileView,
  );
  /** In-memory score history for the open project (Report charts). */
  let scoreHistoryCache: AnalysisScoreSnapshot[] = [];
  let scoreHistoryProject: string | null = null;

  const rulesState: RulesPanelState = {
    rules: [],
    selected: new Set(persisted.selectedRuleIds),
    settings: persisted.ruleSettings,
    expandedRuleId: null,
    loading: true,
    loadError: null,
    gitleaksStatus: null,
    gitleaksInstalling: false,
    gitleaksInstallError: null,
    trufflehogStatus: null,
    trufflehogInstalling: false,
    trufflehogInstallError: null,
  };

  const migratedAi = migratePersistedAiSettings(persisted);
  let setupWizardCompleted = Boolean(persisted.setupWizardCompleted);
  let setupWizardOpen = false;

  function rulesPanelContext(): RulesPanelContext {
    return {
      llmProviders: app.llmProviders,
      llmConfigurations: app.llmConfigurations,
      onInstallGitleaks: () => {
        void installGitleaksTool();
      },
      onInstallTrufflehog: () => {
        void installTrufflehogTool();
      },
    };
  }

  async function refreshGitleaksStatus(): Promise<void> {
    try {
      rulesState.gitleaksStatus = await getGitleaksStatus();
      rulesState.gitleaksInstallError = null;
    } catch (err) {
      console.error(err);
      rulesState.gitleaksInstallError =
        err instanceof Error ? err.message : String(err);
    }
    renderRulesPanel();
  }

  async function refreshTrufflehogStatus(): Promise<void> {
    try {
      rulesState.trufflehogStatus = await getTrufflehogStatus();
      rulesState.trufflehogInstallError = null;
    } catch (err) {
      console.error(err);
      rulesState.trufflehogInstallError =
        err instanceof Error ? err.message : String(err);
    }
    renderRulesPanel();
  }

  async function installGitleaksTool(prompt = true): Promise<boolean> {
    if (rulesState.gitleaksInstalling) return false;
    if (prompt) {
      const ok = window.confirm(t("boot.confirmInstallGitleaks"));
      if (!ok) return false;
    }
    rulesState.gitleaksInstalling = true;
    rulesState.gitleaksInstallError = null;
    renderRulesPanel();
    try {
      const result = await installGitleaks();
      rulesState.gitleaksStatus = result.status;
      if (!result.ok) {
        rulesState.gitleaksInstallError = result.message;
        if (prompt) {
          await showInstallReport(t("boot.gitleaksInstallFailed"), result.message, "error");
        }
        return false;
      }
      rulesState.gitleaksInstallError = null;
      if (prompt) {
        await showInstallReport(t("boot.gitleaksInstalled"), result.message, "success");
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rulesState.gitleaksInstallError = message;
      if (prompt) {
        await showInstallReport(t("boot.gitleaksInstallFailed"), message, "error");
      }
      return false;
    } finally {
      rulesState.gitleaksInstalling = false;
      renderRulesPanel();
    }
  }

  async function installTrufflehogTool(prompt = true): Promise<boolean> {
    if (rulesState.trufflehogInstalling) return false;
    if (prompt) {
      const ok = window.confirm(t("boot.confirmInstallTrufflehog"));
      if (!ok) return false;
    }
    rulesState.trufflehogInstalling = true;
    rulesState.trufflehogInstallError = null;
    renderRulesPanel();
    try {
      const result = await installTrufflehog();
      rulesState.trufflehogStatus = result.status;
      if (!result.ok) {
        rulesState.trufflehogInstallError = result.message;
        if (prompt) {
          await showInstallReport(t("boot.trufflehogInstallFailed"), result.message, "error");
        }
        return false;
      }
      rulesState.trufflehogInstallError = null;
      if (prompt) {
        await showInstallReport(t("boot.trufflehogInstalled"), result.message, "success");
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rulesState.trufflehogInstallError = message;
      if (prompt) {
        await showInstallReport(t("boot.trufflehogInstallFailed"), message, "error");
      }
      return false;
    } finally {
      rulesState.trufflehogInstalling = false;
      renderRulesPanel();
    }
  }

  async function showInstallReport(
    title: string,
    message: string,
    tone: "success" | "error",
  ): Promise<void> {
    const { summary, body } = splitInstallReport(message);
    await showMessageDialog({ title, summary, body, tone });
  }

  function offerGitleaksInstall(result: AnalysisResult): void {
    const item = result.validation.find(
      (entry) =>
        entry.rule_id === "gitleaks" && isGitleaksMissingMessage(entry.message),
    );
    if (!item || rulesState.gitleaksStatus?.status === "installed") {
      return;
    }
    if (
      window.confirm(t("boot.offerGitleaks"))
    ) {
      void installGitleaksTool(false);
    }
  }

  function offerTrufflehogInstall(result: AnalysisResult): void {
    const item = result.validation.find(
      (entry) =>
        entry.rule_id === "trufflehog" &&
        isTrufflehogMissingMessage(entry.message),
    );
    if (!item || rulesState.trufflehogStatus?.status === "installed") {
      return;
    }
    if (
      window.confirm(t("boot.offerTrufflehog"))
    ) {
      void installTrufflehogTool(false);
    }
  }

  function renderRulesPanel(): void {
    createRulesPanel(
      rulesContainer,
      rulesState,
      onRulesPanelChange,
      rulesPanelContext(),
    );
  }

  const app: AppState = {
    projectPath: null,
    projectScan: null,
    selectedRules: rulesState.selected,
    ruleSettings: rulesState.settings,
    lspSettings: {},
    linterSettings: initialLinterSettings,
    llmConfigurations: migratedAi.llmConfigurations,
    aiValidationRuntime: migrateRuntimeSettings(persisted.aiValidationRuntime),
    analysisTriggers: {
      ...defaultAnalysisTriggerConfig(),
      ...(persisted.analysisTriggers ?? {}),
    },
    llmProviders: [],
    analysisResult: null,
    hierarchy: null,
    graphNavigation: persisted.graphNavigation ?? rootNavigation(),
    renderState: null,
    modulesListState: {
      graphNodes: [],
      graphEdges: [],
      visibleIds: new Set(),
      searchQuery: "",
    },
    hierarchyLoading: false,
    dsmLevel: persisted.dsmLevel === "file" ? "file" : "package",
    dsmOrdering:
      persisted.dsmOrdering === "hierarchical" ? "hierarchical" : "partitioned",
    designRules: persisted.designRules ?? defaultDesignRules(),
    centerView: "graph",
  };

  const moduleDetailsPanel = createModuleDetailsPanel(moduleDetailsPanelEl, {
    getPercentileView: () => percentileView,
    onPercentileViewChange: (mode) => {
      percentileView = mode;
      persist();
      resultsPanel?.setResult(app.analysisResult);
    },
    onSelectRelated: (nodeId) => {
      void showModuleOnGraph(nodeId);
    },
    onOpenContent: (nodeId) => {
      if (app.renderState?.nodes.some((node) => node.id === nodeId)) {
        void showModuleOnGraph(nodeId);
        return;
      }
      // Contents live one level deeper — open that level on the graph.
      const parentId = moduleDetailsPanel.currentNodeId();
      if (parentId) drillIntoNode(parentId);
    },
    onOpenSource: (path, line) => {
      void handleFileOpen(path, line);
    },
    onDrillInto: (nodeId) => {
      drillIntoNode(nodeId);
    },
    onClose: () => {
      if (!isGraphPopupOpen()) setHighlight(null);
    },
  });

  async function initRulesPanel(): Promise<void> {
    if (!rulesState.loading && rulesState.rules.length > 0) return;
    rulesState.loading = true;
    rulesState.loadError = null;
    renderRulesPanel();

    try {
      const rules = await loadAnalysisRules();
      const selected = new Set(
        persisted.selectedRuleIds.length > 0
          ? persisted.selectedRuleIds
          : rules.map((r) => r.id),
      );
      if (
        persisted.selectedRuleIds.length > 0 &&
        !selected.has("language_linters") &&
        rules.some((r) => r.id === "language_linters")
      ) {
        selected.add("language_linters");
      }
      if (
        persisted.selectedRuleIds.length > 0 &&
        !selected.has("circular_dependencies") &&
        rules.some((r) => r.id === "circular_dependencies")
      ) {
        selected.add("circular_dependencies");
      }
      if (
        persisted.selectedRuleIds.length > 0 &&
        !selected.has("gitleaks") &&
        rules.some((r) => r.id === "gitleaks")
      ) {
        selected.add("gitleaks");
      }

      rulesState.rules = rules;
      rulesState.selected = selected;
      rulesState.settings = mergeRuleSettings(rules, persisted.ruleSettings);
      rulesState.loading = false;
      app.selectedRules = rulesState.selected;
      app.ruleSettings = rulesState.settings;
      renderRulesPanel();
      void refreshGitleaksStatus();
      void refreshTrufflehogStatus();
    } catch (err) {
      rulesState.loading = false;
      rulesState.loadError =
        err instanceof Error ? err.message : String(err);
      renderRulesPanel();
    }
  }

  function onRulesPanelChange(
    selected: Set<string>,
    settings: RuleSettingsMap,
  ): void {
    app.selectedRules = selected;
    app.ruleSettings = settings;
    rulesState.settings = settings;
    persist();
  }

  let resultsPanel!: ReturnType<typeof createResultsPanel>;
  let settingsApi!: ReturnType<typeof createSettingsPanel>;
  let settingsPanelOpen = Boolean(persisted.settingsPanelOpen);

  const llmProviderConfigsPanel = createLlmProviderConfigsPanel(
    llmProviderConfigsContainer,
    {
      onChange: (configs) => {
        app.llmConfigurations = configs;
        renderRulesPanel();
        persist();
      },
    },
  );
  llmProviderConfigsPanel.setConfigs(app.llmConfigurations);

  const llmRuntimeSettingsPanel = createLlmRuntimeSettingsPanel(
    llmRuntimeSettingsContainer,
    {
      onChange: (settings) => {
        app.aiValidationRuntime = settings;
        persist();
      },
    },
  );
  llmRuntimeSettingsPanel.setSettings(app.aiValidationRuntime);

  void getLlmProviders().then((providers) => {
    app.llmProviders = providers;
    llmProviderConfigsPanel.setProviders(providers);
    renderRulesPanel();
  });

  const analysisManager = createAnalysisManager({
    onRunsChanged: (runs) => {
      resultsPanel.setRuns(runs);
      btnStop.disabled = !runs.some((run) => run.status === "running");
    },
    onRunCompleted: (run) => {
      if (run.id === analysisManager.getLatestRunId() && run.result) {
        void applyAnalysisResult(run.result);
        offerGitleaksInstall(run.result);
        offerTrufflehogInstall(run.result);
      }
    },
    onRunFailed: (run) => {
      console.error(run.error);
      alert(t("boot.analysisFailed", { error: String(run.error) }));
    },
  });

  resultsPanel = createResultsPanel(
    resultsContainer,
    {
      getHierarchy: () => app.hierarchy,
      getPercentileView: () => percentileView,
      onPercentileViewChange: (mode) => {
        percentileView = mode;
        persist();
        if (moduleDetailsPanel.isOpen()) {
          moduleDetailsPanel.updateQuality({});
        }
      },
      onOpenValidationTarget: (target) => {
        void openValidationTarget(target);
      },
      onShowValidationOnGraph: (target) => {
        void showValidationTargetOnGraph(target);
      },
      onShowCycleOnGraph: (cycle) => {
        void showCycleOnGraph(cycle);
      },
      onInstallGitleaks: () => {
        void installGitleaksTool();
      },
      onInstallTrufflehog: () => {
        void installTrufflehogTool();
      },
      onShowModuleOnGraph: (nodeId) => {
        void showModuleOnGraph(nodeId);
      },
      onOpenModuleFile: (path, line) => {
        void handleFileOpen(path, line);
      },
      onShowDependencyOnGraph: (source, target) => {
        void showDependencyOnGraph(source, target);
      },
      onShowDsm: (highlightIds) => {
        showDsmView();
        if (highlightIds && highlightIds.length > 0) {
          dsmView.highlight(highlightIds);
        }
      },
      onCancelRun: (id) => analysisManager.cancel(id),
      onCancelAllRuns: () => analysisManager.cancelAll(),
      onApplyRun: (id) => {
        const run = analysisManager.getRuns().find((r) => r.id === id);
        if (run?.result) {
          void applyAnalysisResult(run.result);
        }
      },
      onRequestShowReport: () => {
        showReportView();
      },
      onRequestShowProgress: () => {
        showProgressView();
      },
      getScoreHistory: async () => {
        const root = app.projectPath;
        if (!root) return [];
        if (scoreHistoryProject === root) return scoreHistoryCache;
        scoreHistoryCache = await loadScoreHistory(root);
        scoreHistoryProject = root;
        return scoreHistoryCache;
      },
      onRequestQualityFiles: async () => {
        if (!app.analysisResult) return null;
        const quality = await loadAnalysisQualityWithFiles(
          app.analysisResult,
          app.projectPath,
        );
        if (!quality || !app.analysisResult) return null;
        app.analysisResult = { ...app.analysisResult, quality };
        resultsPanel.setResult(app.analysisResult);
        if (moduleDetailsPanel.isOpen()) {
          moduleDetailsPanel.updateQuality({});
        }
        return quality;
      },
    },
    { reportHost: analysisReportViewEl, progressHost: analysisProgressViewEl },
  );

  /** Camera / visibility to apply on the first graph hydrate after session restore. */
  let pendingGraphRestore: {
    visibleIds?: string[];
    camera?: PersistedAppState["camera"];
    selectedId?: string | null;
  } | null = null;
  let hierarchyLoadGeneration = 0;

  async function applyAnalysisResult(result: AnalysisResult): Promise<void> {
    clearHierarchyLoadCache();
    clearQualityLoadCache();
    hierarchyLoadGeneration += 1;
    app.renderState = null;
    pendingGraphRestore = null;

    // Slim IPC already has: summary, validation, package graph, package quality, dsm.
    // Do NOT load hierarchy-lite / quality.files here — that freezes large projects.
    app.analysisResult = result;
    app.hierarchy = null;
    app.graphNavigation = rootNavigation();
    resultsPanel.setResult(result);
    showReportView();
    // Ensure crumbs paint even if Report chrome raced with other clears.
    refreshBreadcrumbs(result.graph);
    persist();
    persistAnalysis();

    if (app.projectPath) {
      try {
        scoreHistoryCache = await appendScoreHistorySnapshot(
          result,
          app.projectPath,
          percentileView,
        );
        scoreHistoryProject = app.projectPath;
        resultsPanel.refreshReport();
      } catch (err) {
        console.warn("Failed to append score history", err);
      }
    }

    // Hydrate the package graph in the background; Report stays front-and-center.
    try {
      if (result.graph?.nodes?.length) {
        await loadGraph(result.graph);
      }
    } catch (err) {
      console.error("Failed to layout package graph", err);
    }

    // DSM refresh uses package-level data already on the result.
    runWhenIdle(() => {
      refreshDsmView();
      renderDesignRulesPanel();
    }, 300);
  }

  const fileViewer = createLazyFileViewer(
    () => fileViewerEl,
    () => showGraphView(),
    {
      saveButton: btnSaveFile,
      onSave: async (path, content) => {
        if (!app.projectPath) return;
        await writeProjectFile(app.projectPath, path, content);
      },
    },
  );

  async function ensureAnalysisHierarchy(opts?: {
    /** Skip center overlay (caller shows its own placeholder). */
    silent?: boolean;
  }): Promise<HierarchyIndex | null> {
    if (hierarchyIsHydrated(app.hierarchy)) {
      return app.hierarchy;
    }
    if (!app.analysisResult) return null;

    if (hierarchyIsHydrated(app.analysisResult.hierarchy)) {
      app.hierarchy = app.analysisResult.hierarchy;
      return app.hierarchy;
    }

    if (app.hierarchyLoading) {
      // Wait briefly for the in-flight load instead of returning empty.
      for (let i = 0; i < 200 && app.hierarchyLoading; i++) {
        await new Promise((r) => setTimeout(r, 25));
        if (hierarchyIsHydrated(app.hierarchy)) return app.hierarchy;
        if (hierarchyIsHydrated(app.analysisResult?.hierarchy)) {
          app.hierarchy = app.analysisResult!.hierarchy;
          return app.hierarchy;
        }
      }
      return hierarchyIsHydrated(app.hierarchy) ? app.hierarchy : null;
    }

    const generation = ++hierarchyLoadGeneration;
    app.hierarchyLoading = true;
    if (!opts?.silent) {
      showOverlay(
        t("overlay.loadingGraph"),
        t("overlay.loadingGraphDetail"),
      );
    }
    refreshModulesList({ loading: true });
    try {
      const hierarchy = await loadAnalysisHierarchy(
        app.analysisResult,
        app.projectPath,
      );

      // A fresher analysis may have landed while we were loading from disk.
      if (hierarchyIsHydrated(app.hierarchy)) {
        return app.hierarchy;
      }
      if (hierarchyIsHydrated(app.analysisResult?.hierarchy)) {
        app.hierarchy = app.analysisResult!.hierarchy;
        return app.hierarchy;
      }
      if (generation !== hierarchyLoadGeneration) {
        return hierarchyIsHydrated(app.hierarchy) ? app.hierarchy : null;
      }

      if (hierarchy && hierarchyIsHydrated(hierarchy)) {
        app.hierarchy = hierarchy;
        app.analysisResult = { ...app.analysisResult!, hierarchy };
        return hierarchy;
      }

      if (app.analysisResult?.graph?.nodes?.length) {
        const rebuilt = hierarchyFromGraph(app.analysisResult.graph);
        app.hierarchy = rebuilt;
        app.analysisResult = { ...app.analysisResult, hierarchy: rebuilt };
        return rebuilt;
      }

      return null;
    } finally {
      app.hierarchyLoading = false;
      refreshModulesList({ loading: false });
      if (hierarchyIsHydrated(app.hierarchy)) {
        renderDesignRulesPanel();
        // loadGraph / caller will hide overlay after layout.
      } else if (!app.renderState) {
        showOverlay(t("overlay.graphUnavailable"));
      }
    }
  }

  function refreshFileNav(path: string) {
    const issues = collectFileIssues(app.analysisResult, path);
    refreshBreadcrumbs(undefined, path);
    renderFileNav(graphNavContainer, {
      path,
      issues,
      onIssueClick: (line) => fileViewer.scrollToLine(line),
    });
  }

  function breadcrumbCallbacks() {
    return {
      onBack: () => {
        hideModuleOverlays();
        app.graphNavigation = goBack(app.graphNavigation);
        ensureGraphChromeForNav();
        void navigateGraph();
      },
      onForward: () => {
        hideModuleOverlays();
        app.graphNavigation = goForward(app.graphNavigation);
        ensureGraphChromeForNav();
        void navigateGraph();
      },
      onNavigate: (crumb: Parameters<typeof navigateTo>[1]) => {
        hideModuleOverlays();
        app.graphNavigation = navigateTo(app.graphNavigation, crumb);
        ensureGraphChromeForNav();
        void navigateGraph({ skipAutoAdvance: true });
      },
    };
  }

  /** Crumb / history actions should land on Graph (or stay on DSM). */
  function ensureGraphChromeForNav(): void {
    if (app.centerView === "graph" || app.centerView === "dsm") return;
    app.centerView = "graph";
    hideCenterViews();
    canvas.classList.remove("hidden");
    setActiveViewTab("graph");
  }

  /** Always keep package crumbs visible when graph or project context exists. */
  function refreshBreadcrumbs(graph?: Graph, filePath?: string): void {
    if (!breadcrumbBar) return;

    if (filePath) {
      renderBreadcrumbBar(
        breadcrumbBar,
        app.graphNavigation,
        canGoBack(app.graphNavigation),
        canGoForward(app.graphNavigation),
        breadcrumbCallbacks(),
        { filePath },
      );
      return;
    }

    const g = graph ?? app.analysisResult?.graph ?? null;
    if (!app.hierarchy && !g && !app.projectPath && !app.analysisResult) {
      clearBreadcrumbBar(breadcrumbBar);
      return;
    }

    renderBreadcrumbBar(
      breadcrumbBar,
      app.graphNavigation,
      canGoBack(app.graphNavigation),
      canGoForward(app.graphNavigation),
      breadcrumbCallbacks(),
      {
        stats: g
          ? { nodes: g.nodes.length, edges: g.edges.length }
          : app.renderState
            ? {
                nodes: app.renderState.nodes.length,
                edges: app.renderState.edges.length,
              }
            : undefined,
        hint:
          app.centerView === "graph"
            ? t("boot.graphHint")
            : null,
      },
    );
  }

  function collectUiState(): PersistedUiState {
    return {
      version: 1,
      panelSizes: readPanelSizes(),
      settingsPanelOpen,
      projectPath: app.projectPath,
      selectedRuleIds: Array.from(app.selectedRules),
      ruleSettings: app.ruleSettings,
      lspSettings: app.lspSettings,
      linterSettings: app.linterSettings,
      llmConfigurations: app.llmConfigurations,
      aiValidationRuntime: app.aiValidationRuntime,
      analysisTriggers: app.analysisTriggers,
      visibleModuleIds: Array.from(app.modulesListState.visibleIds),
      selectedNodeId: app.renderState?.selectedId ?? null,
      camera: app.renderState
        ? { ...app.renderState.camera }
        : null,
      graphNavigation: serializeNavigation(app.graphNavigation),
      dsmLevel: app.dsmLevel,
      dsmOrdering: app.dsmOrdering,
      percentileView,
      designRules: app.designRules,
      layoutMode,
      edgeStyle,
      moduleFilters: { ...moduleFilters },
      languageFilters: { ...languageFilters },
      uiLocale,
      setupWizardCompleted,
    };
  }

  function persist(): void {
    scheduleSaveUiState(collectUiState());
  }

  async function persistUiNow(): Promise<void> {
    await saveUiStateNow(collectUiState());
  }

  let languagePanelApi: ReturnType<typeof createLanguagePanel> | null = null;

  function applyShellI18n(): void {
    applyDomTranslations(document);
    if (!app.projectPath) {
      projectPathEl.textContent = t("app.noProject");
      projectPathEl.removeAttribute("title");
    }
    mountToolbarIcons();
    initTooltips();
    languagePanelApi?.render();
  }

  function persistAnalysis(): void {
    scheduleSaveAnalysis(app.analysisResult, app.projectPath);
  }

  function setActiveViewTab(
    view: "report" | "progress" | "graph" | "dsm" | "file",
  ): void {
    viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === view);
    });
  }

  function hideCenterViews(): void {
    analysisReportViewEl.classList.add("hidden");
    analysisProgressViewEl.classList.add("hidden");
    fileViewerEl.classList.add("hidden");
    dsmViewEl.classList.add("hidden");
    canvas.classList.add("hidden");
  }

  function dismissRunDialogs(): void {
    document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
  }

  function showReportView(): void {
    app.centerView = "report";
    hideCenterViews();
    hideOverlay();
    analysisReportViewEl.classList.remove("hidden");
    setActiveViewTab("report");
    graphNavContainer.innerHTML = "";
    refreshBreadcrumbs(app.analysisResult?.graph);
    resultsPanel.refreshReport();
  }

  function showProgressView(): void {
    app.centerView = "progress";
    hideCenterViews();
    hideOverlay();
    dismissRunDialogs();
    analysisProgressViewEl.classList.remove("hidden");
    setActiveViewTab("progress");
    graphNavContainer.innerHTML = "";
    refreshBreadcrumbs(app.analysisResult?.graph);
    resultsPanel.refreshProgress();
  }

  function refreshDsmView(): void {
    const hierarchy = app.hierarchy ?? app.analysisResult?.hierarchy ?? null;
    let preferred = app.analysisResult?.dsm ?? null;
    if (hierarchy && preferred) {
      const violations = checkDesignRules(hierarchy, app.designRules);
      preferred = { ...preferred, violations };
    } else if (hierarchy) {
      const computed = computeDsm(hierarchy, {
        level: app.dsmLevel,
        scope: null,
        ordering: app.dsmOrdering,
      });
      computed.violations = checkDesignRules(hierarchy, app.designRules);
      preferred = computed;
    }
    dsmView.setData(
      hierarchy,
      app.graphNavigation,
      { level: app.dsmLevel, ordering: app.dsmOrdering },
      preferred,
    );
  }

  function designRulePackageIds(): string[] {
    const hierarchy = app.hierarchy ?? app.analysisResult?.hierarchy ?? null;
    const result = app.analysisResult;
    return collectDesignRulePackageIds({
      hierarchy,
      graph: result?.graph ?? null,
      qualityPackageKeys: result?.quality
        ? Object.keys(result.quality.packages)
        : [],
      dsmElementIds: result?.dsm?.elements?.map((e) => e.id) ?? [],
    });
  }

  function renderDesignRulesPanel(): void {
    createDesignRulesPanel(designRulesContainer, app.designRules, {
      packageIds: designRulePackageIds(),
      onChange: (rules, meta) => {
        app.designRules = rules;
        persist();
        if (meta?.refreshPanel) {
          renderDesignRulesPanel();
        }
        recheckDesignRulesInPlace();
      },
      onSuggestLayers: () => {
        const hierarchy = app.hierarchy ?? app.analysisResult?.hierarchy;
        if (!hierarchy) {
          alert(t("boot.suggestLayersFirst"));
          return;
        }
        const dsm = computeDsm(hierarchy, {
          level: "package",
          ordering: "partitioned",
        });
        const suggested = suggestLayersFromPartition(dsm.elements.map((e) => e.id));
        app.designRules = [
          ...app.designRules.filter((r) => r.kind !== "layers"),
          suggested,
        ];
        persist();
        renderDesignRulesPanel();
        recheckDesignRulesInPlace();
      },
    });
  }

  function recheckDesignRulesInPlace(): void {
    if (!app.analysisResult?.hierarchy) {
      refreshDsmView();
      return;
    }
    const violations = checkDesignRules(
      app.analysisResult.hierarchy,
      app.designRules,
    );
    let result = app.analysisResult;
    if (result.dsm) {
      result = { ...result, dsm: { ...result.dsm, violations } };
    }
    if (app.designRules.length > 0) {
      const item = designRulesValidationItem(violations);
      const without = result.validation.filter(
        (v) => v.rule_id !== "architecture_conformance",
      );
      result = { ...result, validation: [...without, item] };
    } else {
      result = {
        ...result,
        validation: result.validation.filter(
          (v) => v.rule_id !== "architecture_conformance",
        ),
      };
    }
    app.analysisResult = result;
    resultsPanel.setResult(result);
    persistAnalysis();
    refreshDsmView();
  }

  renderDesignRulesPanel();

  function showGraphView() {
    app.centerView = "graph";
    hideCenterViews();
    canvas.classList.remove("hidden");
    setActiveViewTab("graph");
    if (app.analysisResult && !app.renderState) {
      const opts = pendingGraphRestore;
      pendingGraphRestore = null;
      void navigateGraph(opts ?? undefined);
      return;
    }
    if (app.renderState) {
      refreshGraphNav(app.analysisResult?.graph);
      // Layout often finished while Report hid the canvas (0×0). Remeasure + redraw.
      requestAnimationFrame(() => {
        resize();
        if (app.renderState) {
          fitCameraToContent(app.renderState, canvas);
          draw();
        }
      });
      return;
    }
    if (app.analysisResult?.graph) {
      refreshGraphNav(app.analysisResult.graph);
      return;
    }
    if (!app.renderState) {
      showGuidedOverlay();
    }
  }

  function showDsmView() {
    app.centerView = "dsm";
    hideCenterViews();
    hideOverlay();
    dsmViewEl.classList.remove("hidden");
    setActiveViewTab("dsm");
    // Package DSM is already on the slim result — no hierarchy load required.
    void (async () => {
      if (app.analysisResult?.dsm) {
        dsmView.setLoading(null);
        refreshDsmView();
        refreshGraphNav(app.analysisResult.graph);
        return;
      }
      dsmView.setLoading(t("boot.loadingDsm"));
      const hierarchy = await ensureAnalysisHierarchy({ silent: true });
      if (!hierarchy) {
        dsmView.setLoading(null);
        refreshDsmView();
        return;
      }
      app.hierarchy = hierarchy;
      if (app.analysisResult && !app.analysisResult.dsm) {
        const dsm = computeDsm(hierarchy);
        app.analysisResult = { ...app.analysisResult, dsm };
        resultsPanel.setResult(app.analysisResult);
      }
      dsmView.setLoading(null);
      refreshDsmView();
      refreshGraphNav();
    })();
  }

  function showFileView() {
    app.centerView = "file";
    hideCenterViews();
    hideOverlay();
    setActiveViewTab("file");
    if (fileViewer.isOpen()) {
      fileViewerEl.classList.remove("hidden");
      const path = fileViewer.getPath();
      if (path) refreshFileNav(path);
      return;
    }
    fileViewer.showGuide();
    graphNavContainer.innerHTML = "";
    clearBreadcrumbBar(breadcrumbBar);
  }

  const dsmView = createDsmView(dsmViewEl, {
    onOptionsChange: (opts) => {
      app.dsmLevel = opts.level === "file" ? "file" : "package";
      app.dsmOrdering =
        opts.ordering === "hierarchical" ? "hierarchical" : "partitioned";
      persist();
      refreshDsmView();
    },
    onSelectElement: (id) => {
      dsmView.highlight([id]);
    },
    onSelectCell: (rowId, colId) => {
      dsmView.highlight([rowId, colId]);
    },
    onShowOnGraph: () => {
      showGraphView();
      void navigateGraph();
    },
  });

  viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.view === "report") showReportView();
      else if (tab.dataset.view === "progress") showProgressView();
      else if (tab.dataset.view === "graph") showGraphView();
      else if (tab.dataset.view === "dsm") showDsmView();
      else if (tab.dataset.view === "file") showFileView();
    });
  });

  createRulesPanel(rulesContainer, rulesState, onRulesPanelChange);
  runWhenIdle(() => {
    void initRulesPanel();
  });

  const lspState: LspServersPanelState = {
    servers: [],
    settings: mergeLspSettings([], persisted.lspSettings),
    expandedServerId: null,
    installingId: null,
    errors: {},
    loading: false,
  };

  let lspLoaded = false;
  const lspHandlers = {
    onRefresh: async () => {
      if (lspState.loading) return;
      lspState.loading = true;
      createLspServersPanel(lspServersContainer, lspState, lspHandlers);
      try {
        lspState.servers = await fetchLspServers();
        lspState.settings = mergeLspSettings(
          lspState.servers,
          lspState.settings,
        );
        app.lspSettings = lspState.settings;
        lspState.errors = {};
        lspLoaded = true;
        persist();
      } catch (err) {
        console.error(err);
      } finally {
        lspState.loading = false;
        createLspServersPanel(lspServersContainer, lspState, lspHandlers);
      }
    },
    onInstall: async (id: string) => {
      lspState.installingId = id;
      delete lspState.errors[id];
      createLspServersPanel(lspServersContainer, lspState, lspHandlers);
      try {
        const result = await runInstallLspServer(id);
        lspState.servers = lspState.servers.map((s) =>
          s.id === id ? result.server : s,
        );
        if (!result.ok) {
          lspState.errors[id] = result.message;
        } else {
          lspState.servers = await fetchLspServers();
          lspState.settings = mergeLspSettings(
            lspState.servers,
            lspState.settings,
          );
          app.lspSettings = lspState.settings;
          persist();
        }
      } catch (err) {
        lspState.errors[id] =
          err instanceof Error ? err.message : String(err);
      } finally {
        lspState.installingId = null;
        createLspServersPanel(lspServersContainer, lspState, lspHandlers);
      }
    },
    onSettingsChange: (settings: LspSettingsMap) => {
      lspState.settings = settings;
      app.lspSettings = settings;
      persist();
    },
  };

  createLspServersPanel(lspServersContainer, lspState, lspHandlers);

  const lintersState: LintersPanelState = {
    groups: [],
    settings: initialLinterSettings,
    expandedLanguageId: null,
    installingKey: null,
    errors: {},
    loading: false,
  };

  let lintersLoaded = false;
  const lintersHandlers = {
    onRefresh: async () => {
      if (lintersState.loading) return;
      lintersState.loading = true;
      createLintersPanel(lintersContainer, lintersState, lintersHandlers);
      try {
        lintersState.groups = await listLanguageLinters();
        lintersState.settings = ensureLinterSettings(
          lintersState.settings,
          lintersState.groups,
        );
        app.linterSettings = lintersState.settings;
        lintersState.errors = {};
        lintersLoaded = true;
        persist();
      } catch (err) {
        console.error(err);
      } finally {
        lintersState.loading = false;
        createLintersPanel(lintersContainer, lintersState, lintersHandlers);
      }
    },
    onInstall: async (languageId: string, linterId: string) => {
      const key = `${languageId}:${linterId}`;
      lintersState.installingKey = key;
      delete lintersState.errors[key];
      createLintersPanel(lintersContainer, lintersState, lintersHandlers);
      try {
        const result = await installLinter(languageId, linterId);
        if (!result.ok) {
          lintersState.errors[key] = result.message;
        } else {
          lintersState.groups = await listLanguageLinters();
          if (!lintersState.settings[languageId]) {
            lintersState.settings[languageId] = {};
          }
          lintersState.settings[languageId].linter_id = linterId;
          lintersState.settings = ensureLinterSettings(
            lintersState.settings,
            lintersState.groups,
          );
          app.linterSettings = lintersState.settings;
          persist();
        }
      } catch (err) {
        lintersState.errors[key] =
          err instanceof Error ? err.message : String(err);
      } finally {
        lintersState.installingKey = null;
        createLintersPanel(lintersContainer, lintersState, lintersHandlers);
      }
    },
    onSettingsChange: (settings: LinterSettingsMap) => {
      lintersState.settings = settings;
      app.linterSettings = settings;
      persist();
    },
  };

  createLintersPanel(lintersContainer, lintersState, lintersHandlers);

  languagePanelApi = createLanguagePanel(languagePanelContainer, (locale) => {
    uiLocale = locale;
    void persistUiNow();
    refreshAllUiForLocale();
  });

  function refreshAllUiForLocale(): void {
    applyShellI18n();
    updateRunButtonHint();
    renderRulesPanel();
    createLspServersPanel(lspServersContainer, lspState, lspHandlers);
    createLintersPanel(lintersContainer, lintersState, lintersHandlers);
    llmProviderConfigsPanel.setConfigs(app.llmConfigurations);
    llmRuntimeSettingsPanel.setSettings(app.aiValidationRuntime);
    renderDesignRulesPanel();

    if (!app.projectPath) {
      renderProjectTree(treeContainer, null, { onFileOpen: handleFileOpen });
    }
    refreshModulesList();
    refreshGraphNav(app.analysisResult?.graph);
    refreshBreadcrumbs(app.analysisResult?.graph);
    resultsPanel.setResult(app.analysisResult);
    refreshDsmView();
    moduleDetailsPanel.refresh();

    if (!fileViewer.isOpen() && app.centerView === "file") {
      fileViewer.showGuide();
    }

    // Only refresh empty-state CTAs — never clobber a busy layout/loading overlay.
    if (graphOverlay.classList.contains("flow-overlay-interactive")) {
      showGuidedOverlay();
    }
  }

  settingsApi = createSettingsPanel(settingsPanel, {
    initiallyOpen: settingsPanelOpen,
    onOpen: () => {
      requestAnimationFrame(() => {
        resize();
        if (rulesState.loading || rulesState.rules.length === 0) {
          void initRulesPanel();
        }
        if (!lspLoaded) void lspHandlers.onRefresh();
        if (!lintersLoaded) void lintersHandlers.onRefresh();
      });
    },
    onToggle: (open) => {
      settingsPanelOpen = open;
      resize();
      persist();
    },
  });
  btnSettings.addEventListener("click", () => settingsApi.toggle());
  btnSetupWizard?.addEventListener("click", () => {
    void launchSetupWizard();
  });
  btnSetupGuide?.addEventListener("click", () => {
    void launchSetupWizard();
  });

  initResizers(
    () => resize(),
    () => persist(),
  );

  async function reorganizeVisibleLayout(): Promise<void> {
    if (!app.renderState) return;
    const visibleIds = app.modulesListState.visibleIds;
    const visibleGraph: Graph = {
      nodes: app.renderState.nodes.filter((node) => visibleIds.has(node.id)),
      edges: app.renderState.edges.filter(
        (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
      ),
    };
    const positionsList = await computeLayout(visibleGraph, layoutMode);
    await animateLayoutTransition(
      app.renderState,
      new Map(positionsList.map((position) => [position.id, position])),
      draw,
      { fitCamera: true, canvas },
    );
    persist();
  }

  function languageIndexForFilters() {
    return buildLanguageIndex(app.hierarchy ?? app.analysisResult?.hierarchy);
  }

  function visibleIdsForCurrentFilters(
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): Set<string> {
    const roleVisible = visibleIdsForFilters(nodes, edges, moduleFilters);
    const langVisible = visibleIdsForLanguageFilters(
      nodes,
      languageFilters,
      languageIndexForFilters(),
    );
    const visible = new Set<string>();
    for (const id of roleVisible) {
      if (langVisible.has(id)) visible.add(id);
    }
    return visible;
  }

  function applyGraphFilters(): void {
    if (app.renderState) {
      void applyVisibilityThenReorganize(
        visibleIdsForCurrentFilters(
          app.renderState.nodes,
          app.renderState.edges,
        ),
      );
    } else {
      persist();
    }
  }

  async function applyVisibilityThenReorganize(
    nextVisible: Set<string>,
  ): Promise<void> {
    if (!app.renderState) return;
    await animateVisibilityTransition(app.renderState, nextVisible, draw);
    app.modulesListState.visibleIds = nextVisible;
    await reorganizeVisibleLayout();
    refreshModulesList();
    persist();
  }

  function syncHiddenFromVisible() {
    void applyVisibilityThenReorganize(app.modulesListState.visibleIds);
  }

  let activeModuleRow: HTMLElement | null = null;
  let highlightDrawScheduled = false;

  function setModuleRowActive(nodeId: string | null): void {
    if (activeModuleRow?.dataset.nodeId === nodeId) return;
    activeModuleRow?.classList.remove("module-row-active");
    activeModuleRow = null;
    if (nodeId == null) return;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(nodeId)
        : nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const next = modulesContainer.querySelector<HTMLElement>(
      `.module-row[data-node-id="${escaped}"]`,
    );
    if (next) {
      next.classList.add("module-row-active");
      activeModuleRow = next;
    }
  }

  function setHighlight(nodeId: string | null) {
    if (!app.renderState) return;
    if (nodeId === null && (isGraphPopupOpen() || moduleDetailsPanel.isOpen())) {
      return;
    }
    if (
      app.renderState.highlightId === nodeId &&
      !app.renderState.highlightCycle
    ) {
      setModuleRowActive(nodeId);
      return;
    }
    app.renderState.highlightCycle = undefined;
    app.renderState.highlightId = nodeId;
    setModuleRowActive(nodeId);
    // Coalesce paints — hovering many module rows used to redraw the full graph each time.
    if (!highlightDrawScheduled) {
      highlightDrawScheduled = true;
      requestAnimationFrame(() => {
        highlightDrawScheduled = false;
        draw();
      });
    }
  }

  function refreshGraphNav(graph?: Graph) {
    // Package crumbs stay available on Report / Progress / Graph / DSM.
    refreshBreadcrumbs(graph);

    if (
      app.centerView === "report" ||
      app.centerView === "progress" ||
      app.centerView === "file"
    ) {
      // Report / Progress / File use their own chrome; keep the graph toolbar unmounted.
      graphNavContainer.innerHTML = "";
      return;
    }
    const g = graph ?? app.analysisResult?.graph ?? null;
    if (!app.hierarchy && !g) {
      graphNavContainer.innerHTML = "";
      return;
    }

    const navCallbacks = breadcrumbCallbacks();
    renderGraphNav(
      graphNavContainer,
      app.graphNavigation,
      canGoBack(app.graphNavigation),
      canGoForward(app.graphNavigation),
      {
        ...navCallbacks,
        onLayoutModeChange: (mode) => {
          layoutMode = mode;
          void reorganizeVisibleLayout();
        },
        onEdgeStyleChange: (style) => {
          edgeStyle = style;
          if (app.renderState) {
            app.renderState.edgeStyle = style;
            draw();
          }
          persist();
        },
        onModuleFiltersChange: (filters) => {
          moduleFilters = filters;
          applyGraphFilters();
        },
        onLanguageFiltersChange: (filters) => {
          languageFilters = filters;
          applyGraphFilters();
          // Package-level language membership needs hierarchy file lists.
          if (
            !allLanguageFiltersEnabled(filters) &&
            !hierarchyIsHydrated(app.hierarchy)
          ) {
            void ensureAnalysisHierarchy({ silent: true }).then(() => {
              applyGraphFilters();
              if (app.centerView === "graph") refreshGraphNav();
            });
          }
        },
        onFocusView: () => {
          void reorganizeVisibleLayout();
        },
        onRunAnalysis: () => {
          void handleRunAnalysis();
        },
      },
      {
        stats: g
          ? { nodes: g.nodes.length, edges: g.edges.length }
          : app.renderState
            ? {
                nodes: app.renderState.nodes.length,
                edges: app.renderState.edges.length,
              }
            : undefined,
        staleImports: app.hierarchy
          ? hasStaleImportIndex(app.hierarchy)
          : false,
        layoutMode,
        edgeStyle,
        moduleFilters,
        languageFilters,
        presentLanguages: presentLanguages(
          g?.nodes ?? app.renderState?.nodes ?? [],
          languageIndexForFilters(),
        ),
        focusEnabled: Boolean(app.renderState),
      },
    );
  }

  async function navigateGraph(opts?: {
    visibleIds?: string[];
    camera?: PersistedAppState["camera"];
    selectedId?: string | null;
    skipAutoAdvance?: boolean;
  }) {
    const crumb =
      app.graphNavigation.crumbs[app.graphNavigation.crumbs.length - 1];
    const atPackageRoot = !crumb || crumb.level === "packages";

    // First level: use the slim package graph from analysis — no hierarchy load.
    if (
      atPackageRoot &&
      app.analysisResult?.graph?.nodes?.length &&
      !hierarchyIsHydrated(app.hierarchy)
    ) {
      hideModuleOverlays();
      await loadGraph(app.analysisResult.graph, opts);
      if (app.centerView === "dsm") {
        refreshDsmView();
      }
      return;
    }

    // Drill / DSM file level: load hierarchy-lite (~files+imports, no symbols).
    const hierarchy = await ensureAnalysisHierarchy();
    if (!hierarchy) {
      if (!app.analysisResult) {
        showGuidedOverlay();
      } else if (app.analysisResult.graph?.nodes?.length) {
        await loadGraph(app.analysisResult.graph, opts);
      } else if (!app.renderState) {
        showOverlay(
          t("overlay.graphUnavailableTitle"),
          t("overlay.graphUnavailableDetail"),
        );
      }
      return;
    }
    hideModuleOverlays();
    if (!opts?.skipAutoAdvance) {
      const advanced = autoAdvanceSingleFolder(hierarchy, app.graphNavigation);
      if (advanced !== app.graphNavigation) {
        app.graphNavigation = advanced;
      }
    }
    const graph = graphForNavigation(hierarchy, app.graphNavigation);
    await loadGraph(graph, opts);
    if (app.centerView === "dsm") {
      refreshDsmView();
    }
  }

  function drillIntoNode(nodeId: string) {
    // Lazy-load hierarchy-lite the first time the user drills below packages.
    if (!app.hierarchy) {
      void (async () => {
        const hierarchy = await ensureAnalysisHierarchy();
        if (!hierarchy || !app.renderState) return;
        const node = app.renderState.nodes.find((n) => n.id === nodeId);
        if (!node || !isDrillableNode(node, app.graphNavigation)) return;
        const next = drillTargetForNode(node, app.graphNavigation);
        if (!next) return;
        hideModuleOverlays();
        app.graphNavigation = next;
        void navigateGraph();
      })();
      return;
    }
    if (!app.renderState) return;
    const node = app.renderState.nodes.find((n) => n.id === nodeId);
    if (!node || !isDrillableNode(node, app.graphNavigation)) return;
    const next = drillTargetForNode(node, app.graphNavigation);
    if (!next) return;
    hideModuleOverlays();
    app.graphNavigation = next;
    void navigateGraph();
  }

  async function openSymbolSource(nodeId: string) {
    if (!app.projectPath || !app.renderState) return;
    const node = app.renderState.nodes.find((n) => n.id === nodeId);
    if (!node || !node.path) return;
    const level =
      app.graphNavigation.crumbs[app.graphNavigation.crumbs.length - 1]?.level;
    const isSymbol =
      level === "symbols" ||
      (node.kind !== "package" &&
        node.kind !== "file" &&
        node.kind !== "folder" &&
        (node.line ?? 0) > 0);
    if (!isSymbol) return;

    showFileView();
    fileViewer.showLoading(node.path);
    try {
      const content = await readProjectFile(app.projectPath, node.path);
      fileViewer.open(node.path, content, {
        line: node.line && node.line > 0 ? node.line : undefined,
        issues: collectFileIssues(app.analysisResult, node.path),
      });
      refreshFileNav(node.path);
    } catch (err) {
      console.error(err);
      fileViewer.showGuide();
      alert(t("boot.couldNotOpenFile", { error: String(err) }));
    }
  }

  function hideModuleOverlays(): void {
    hideGraphPopup();
    moduleDetailsPanel.hide();
  }

  /** Project-wide git churn (loaded once; never re-run per module click). */
  let projectChurnCache: import("./analysis/codeQualityMetrics").ChurnMap | null =
    null;
  let projectChurnPromise: Promise<void> | null = null;

  async function ensureProjectChurnLoaded(): Promise<void> {
    if (!app.projectPath) return;
    if (projectChurnCache?.available) return;
    if (projectChurnPromise) return projectChurnPromise;
    const root = app.projectPath;
    projectChurnPromise = (async () => {
      try {
        const { gitCodeChurn } = await import("./project/api");
        const { churnMapFromResult } = await import("./analysis/codeQualityMetrics");
        // One repo-wide numstat; UI slices by file/package.
        const result = await gitCodeChurn(root, ".", 90);
        if (app.projectPath !== root) return;
        projectChurnCache = churnMapFromResult(result);
        if (moduleDetailsPanel.isOpen() && projectChurnCache) {
          moduleDetailsPanel.updateQuality({ churn: projectChurnCache });
        }
      } catch (err) {
        console.warn("Project churn prefetch failed", err);
        projectChurnCache = {
          available: false,
          days: 90,
          byPath: new Map(),
          message: "Git churn unavailable",
        };
      } finally {
        projectChurnPromise = null;
      }
    })();
    return projectChurnPromise;
  }

  function focusModuleOnGraph(nodeId: string): void {
    if (!app.renderState || !app.renderState.nodes.some((node) => node.id === nodeId)) {
      return;
    }
    app.renderState.selectedId = nodeId;
    focusCameraOnNodeAnimated(app.renderState, canvas, nodeId, draw);
    setHighlight(nodeId);
    persist();
  }

  function graphNodeFromHierarchy(nodeId: string): import("./graph/types").GraphNode | null {
    const hierarchy = app.hierarchy;
    if (!hierarchy) return null;
    const file = hierarchy.files.find((f) => f.path === nodeId);
    if (file) {
      return {
        id: file.path,
        label: file.label,
        path: file.path,
        loc: file.loc,
        kind: "file",
      };
    }
    if (hierarchy.packages.includes(nodeId) || nodeId === ".") {
      const loc = hierarchy.files
        .filter(
          (f) =>
            f.package === nodeId ||
            f.path === nodeId ||
            f.path.startsWith(`${nodeId}/`),
        )
        .reduce((sum, f) => sum + f.loc, 0);
      return {
        id: nodeId,
        label: nodeId === "." ? "(root)" : nodeId.split("/").pop() ?? nodeId,
        path: nodeId,
        loc,
        kind: "package",
      };
    }
    return null;
  }

  function showModuleDetailsFor(nodeId: string): void {
    if (!app.renderState) return;
    const node =
      app.renderState.nodes.find((n) => n.id === nodeId) ??
      graphNodeFromHierarchy(nodeId);
    if (!node) return;
    app.renderState.selectedId = nodeId;
    setHighlight(nodeId);
    hideGraphPopup();
    // Package metrics are already in memory; file metrics load lazily below.
    const needsFileQuality =
      Boolean(app.analysisResult) &&
      Object.keys(app.analysisResult?.quality?.files ?? {}).length === 0 &&
      Object.keys(app.analysisResult?.quality?.packages ?? {}).length > 0;
    moduleDetailsPanel.show({
      node,
      nodes: app.renderState.nodes,
      edges: app.renderState.edges,
      hierarchy: app.hierarchy,
      navigation: app.graphNavigation,
      analysis: app.analysisResult,
      churn: projectChurnCache,
      qualityLoading: needsFileQuality,
    });
    persist();
    if (!projectChurnCache) {
      void ensureProjectChurnLoaded();
    }
    // Lazy: pull per-file quality only when opening details (not on analysis apply).
    if (needsFileQuality && app.analysisResult) {
      void loadAnalysisQualityWithFiles(app.analysisResult, app.projectPath).then(
        (quality) => {
          if (!quality || !app.analysisResult) return;
          app.analysisResult = { ...app.analysisResult, quality };
          if (moduleDetailsPanel.isOpen()) {
            moduleDetailsPanel.updateQuality({ qualityLoading: false });
          }
        },
      );
    }
  }

  function openModuleDetails(nodeId: string): void {
    if (!app.renderState) return;
    if (
      moduleDetailsPanel.isOpen() &&
      moduleDetailsPanel.currentNodeId() === nodeId
    ) {
      moduleDetailsPanel.hide();
      return;
    }
    showModuleDetailsFor(nodeId);
  }

  function refreshModulesList(opts?: { loading?: boolean }) {
    activeModuleRow = null;
    if (opts?.loading !== undefined) {
      app.modulesListState.loading = opts.loading;
    }
    renderModulesList(modulesContainer, app.modulesListState, {
      onFocus: (nodeId) => {
        if (!app.renderState) return;
        app.renderState.selectedId = nodeId;
        setHighlight(nodeId);
        focusCameraOnNodeAnimated(app.renderState, canvas, nodeId, draw);
        persist();
      },
      onVisibilityChange: (visibleIds) => {
        app.modulesListState.visibleIds = visibleIds;
        syncHiddenFromVisible();
      },
      onHighlight: (nodeId) => {
        setModuleRowActive(nodeId);
        // Highlight on the graph only when the module is currently shown there.
        if (
          nodeId != null &&
          app.modulesListState.visibleIds.has(nodeId)
        ) {
          setHighlight(nodeId);
        } else {
          setHighlight(null);
        }
      },
      onShowDetails: (nodeId) => {
        showGraphView();
        focusModuleOnGraph(nodeId);
        openModuleDetails(nodeId);
      },
      onOpenFile: (path) => {
        void showModuleOnGraph(path);
      },
    });
  }

  function showOverlay(text: string, detail?: string) {
    renderFlowOverlay(graphOverlay, { title: text, detail });
  }

  function hideOverlay() {
    hideFlowOverlay(graphOverlay);
  }

  /** Empty-state overlay with next-step actions for the open → configure → run flow. */
  function showGuidedOverlay(): void {
    if (!app.projectPath) {
      renderFlowOverlay(graphOverlay, {
        title: t("overlay.openProjectTitle"),
        detail: t("overlay.openProjectDetail"),
        actions: [
          {
            label: t("overlay.openProject"),
            primary: true,
            onClick: () => {
              void handleOpenProject();
            },
          },
          {
            label: t("overlay.setupGuide"),
            onClick: () => {
              void launchSetupWizard();
            },
          },
        ],
      });
      return;
    }

    renderFlowOverlay(graphOverlay, {
      title: t("overlay.runAnalysisTitle"),
      detail: t("overlay.runAnalysisDetail"),
      actions: [
        {
          label: t("overlay.runAnalysis"),
          primary: true,
          onClick: () => {
            void handleRunAnalysis();
          },
        },
        {
          label: t("overlay.configureRules"),
          onClick: () => {
            settingsApi.open("rules");
          },
        },
        {
          label: t("overlay.setupGuide"),
          onClick: () => {
            void launchSetupWizard();
          },
        },
      ],
    });
  }

  function draw() {
    if (!app.renderState) return;
    render(ctx, canvas, app.renderState);
  }

  function canvasCssSize(): { width: number; height: number } {
    // Hidden canvases report 0×0 — fall back to the center content box so layout
    // can finish while Report is showing, then Graph remounts cleanly.
    const width =
      canvas.clientWidth ||
      canvas.parentElement?.clientWidth ||
      0;
    const height =
      canvas.clientHeight ||
      canvas.parentElement?.clientHeight ||
      0;
    return { width, height };
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvasCssSize();
    if (width <= 0 || height <= 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    draw();
  }

  async function loadGraph(
    graph: Graph,
    opts?: { visibleIds?: string[]; camera?: PersistedAppState["camera"]; selectedId?: string | null },
  ) {
    hideModuleOverlays();
    const showLayoutOverlay = app.centerView === "graph";
    if (showLayoutOverlay) {
      showOverlay(
        t("overlay.computingLayout"),
        t("overlay.computingLayoutDetail"),
      );
    }
    refreshModulesList({ loading: true });
    const positionsList = await computeLayout(graph, layoutMode);
    const positions = new Map(positionsList.map((p) => [p.id, p]));

    app.renderState = createRenderState(graph.nodes, graph.edges, positions);
    app.renderState.edgeStyle = edgeStyle;

    const filterVisible = visibleIdsForCurrentFilters(graph.nodes, graph.edges);
    const visible =
      opts?.visibleIds && opts.visibleIds.length > 0
        ? new Set(opts.visibleIds.filter((id) => filterVisible.has(id)))
        : filterVisible;
    app.modulesListState.graphNodes = graph.nodes;
    app.modulesListState.graphEdges = graph.edges;
    app.modulesListState.visibleIds = visible;

    const allIds = new Set(graph.nodes.map((n) => n.id));
    app.renderState.hiddenIds = new Set(
      [...allIds].filter((id) => !visible.has(id)),
    );

    if (opts?.selectedId) {
      app.renderState.selectedId = opts.selectedId;
    }

    resize();
    if (opts?.camera) {
      app.renderState.camera = { ...opts.camera };
    } else {
      fitCameraToContent(app.renderState, canvas);
    }

    if (showLayoutOverlay) {
      hideOverlay();
    }
    draw();
    refreshModulesList({ loading: false });
    // Always rebuild the graph toolbar (layout / filter / focus) after layout.
    refreshGraphNav(graph);
    persist();
  }

  function clearMainPanel(): void {
    hideModuleOverlays();
    fileViewer.close();
    // Switch to graph chrome without hydrating hierarchy for the outgoing project.
    app.centerView = "graph";
    hideCenterViews();
    canvas.classList.remove("hidden");
    setActiveViewTab("graph");
    clearHierarchyLoadCache();
    clearQualityLoadCache();
    projectChurnCache = null;
    projectChurnPromise = null;
    pendingGraphRestore = null;

    app.analysisResult = null;
    app.hierarchy = null;
    app.graphNavigation = rootNavigation();
    app.renderState = null;
    scoreHistoryCache = [];
    scoreHistoryProject = null;
    app.modulesListState = {
      graphNodes: [],
      graphEdges: [],
      visibleIds: new Set(),
      searchQuery: app.modulesListState.searchQuery,
      loading: false,
    };

    resultsPanel.setResult(null);
    refreshModulesList();
    graphNavContainer.innerHTML = "";
    clearBreadcrumbBar(breadcrumbBar);

    const ctx2d = canvas.getContext("2d");
    if (ctx2d) {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = "#0f1115";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    }
    showGuidedOverlay();
  }

  async function openProjectAt(path: string): Promise<boolean> {
    try {
      projectPathEl.textContent = t("boot.scanning");
      const scan = await scanProject(path);

      // Always refresh the main panel when (re)opening a project so the
      // previous project's graph/results don't linger.
      clearMainPanel();

      app.projectPath = scan.root;
      app.projectScan = scan;
      projectChurnCache = null;
      projectChurnPromise = null;

      const displayPath = scan.root.split("/").pop() ?? scan.root;
      projectPathEl.textContent = displayPath;
      projectPathEl.title = scan.root;

      renderProjectTree(treeContainer, scan.tree, {
        onFileOpen: handleFileOpen,
        loadChildren: (relativePath) =>
          listProjectChildren(scan.root, relativePath),
      });
      refreshModulesList();
      btnRun.disabled = false;
      persist();
      await restoreAnalysisTriggers(scan.root);
      refreshBreadcrumbs();
      return true;
    } catch (err) {
      console.error(err);
      projectPathEl.textContent = t("boot.failedOpenProject");
      return false;
    }
  }

  async function handleFileOpen(relativePath: string, line?: number) {
    if (!app.projectPath) return;
    showFileView();
    fileViewer.showLoading(relativePath);
    try {
      const content = await readProjectFile(app.projectPath, relativePath);
      const issues = collectFileIssues(app.analysisResult, relativePath);
      fileViewer.open(relativePath, content, {
        line: line && line > 0 ? line : undefined,
        issues,
      });
      refreshFileNav(relativePath);
    } catch (err) {
      console.error(err);
      fileViewer.showGuide();
      alert(t("boot.couldNotOpenFile", { error: String(err) }));
    }
  }

  async function openValidationTarget(target: ValidationNavTarget) {
    hideValidationDetail();
    const { file, line } = splitPathAndLocation(target.file);
    const openLine = target.line ?? line;
    if (!isOpenableValidationPath(file)) {
      return;
    }
    await handleFileOpen(file, openLine);
  }

  async function showModuleOnGraph(nodeId: string) {
    const hierarchy = await ensureAnalysisHierarchy();
    if (!hierarchy) return;
    hideAnalysisStatDetail();
    hideValidationDetail();
    hideModuleOverlays();
    showGraphView();

    const isFile = hierarchy.files.some((f) => f.path === nodeId);
    if (isFile) {
      // Drill nested folders until the file node itself is on the graph.
      app.graphNavigation = navigationShowingFile(hierarchy, nodeId);
    } else {
      // Packages (and package-like paths) live on the root packages graph.
      app.graphNavigation = rootNavigation();
    }

    const graph = graphForNavigation(hierarchy, app.graphNavigation);
    await loadGraph(graph, { selectedId: nodeId });
    refreshGraphNav(graph);

    if (!app.renderState) return;
    app.renderState.highlightCycle = undefined;
    if (app.renderState.nodes.some((n) => n.id === nodeId)) {
      focusCameraOnNodeAnimated(app.renderState, canvas, nodeId, draw);
      setHighlight(nodeId);
    } else {
      draw();
    }
    // Always open details (synthesize node if nested view still lacks it).
    showModuleDetailsFor(nodeId);
    persist();
  }

  async function showDependencyOnGraph(source: string, target: string) {
    const hierarchy = await ensureAnalysisHierarchy();
    if (!hierarchy) return;
    hideAnalysisStatDetail();
    hideValidationDetail();
    hideModuleOverlays();
    showGraphView();

    app.graphNavigation = rootNavigation();
    const graph = graphForNavigation(hierarchy, app.graphNavigation);
    await loadGraph(graph);
    refreshGraphNav(graph);

    if (!app.renderState) return;
    const nodeIds = [source, target].filter((id) =>
      app.renderState!.nodes.some((n) => n.id === id),
    );
    app.renderState.highlightId = null;
    if (nodeIds.length > 0) {
      app.renderState.highlightCycle = {
        nodeIds: new Set(nodeIds),
        edgeKeys: new Set([`${source}->${target}`]),
      };
      focusCameraOnNodesAnimated(app.renderState, canvas, nodeIds, draw);
    } else {
      app.renderState.highlightCycle = undefined;
      draw();
    }
    persist();
  }

  async function showCycleOnGraph(cycle: CycleGroup) {
    const hierarchy = await ensureAnalysisHierarchy();
    if (!hierarchy) return;
    hideAnalysisStatDetail();
    hideValidationDetail();
    hideModuleOverlays();
    showGraphView();

    const plan = planCycleGraphView(hierarchy, cycle);
    app.graphNavigation = plan.navigation;
    const graph = graphForNavigation(hierarchy, app.graphNavigation);
    await loadGraph(graph);
    refreshGraphNav(graph);

    if (!app.renderState) return;
    app.renderState.highlightCycle =
      plan.nodeIds.length > 0 ? cycleHighlightFromPlan(plan) : undefined;
    app.renderState.highlightId = null;

    if (plan.nodeIds.length > 0) {
      focusCameraOnNodesAnimated(app.renderState, canvas, plan.nodeIds, draw);
    } else if (graph.nodes.length > 0) {
      fitCameraToContent(app.renderState, canvas);
      draw();
    } else {
      draw();
    }
    persist();
  }

  async function showValidationTargetOnGraph(target: ValidationNavTarget) {
    const hierarchy = await ensureAnalysisHierarchy();
    if (!hierarchy) return;
    hideAnalysisStatDetail();
    hideValidationDetail();
    hideModuleOverlays();
    showGraphView();

    const wantsSymbol =
      Boolean(target.symbolId) || (target.line != null && target.line > 0);

    if (wantsSymbol) {
      app.graphNavigation = navigationToFile(hierarchy, target.file);
      let symbolId = target.symbolId;
      if (!symbolId && target.line != null) {
        symbolId = findSymbolAtLine(
          hierarchy,
          target.file,
          target.line,
        )?.id;
      }
      const graph = graphForNavigation(hierarchy, app.graphNavigation);
      await loadGraph(graph, { selectedId: symbolId ?? undefined });
      if (symbolId && app.renderState) {
        focusCameraOnNodeAnimated(app.renderState, canvas, symbolId, draw);
        setHighlight(symbolId);
      }
    } else {
      app.graphNavigation = navigationToPackageFile(hierarchy, target.file);
      const graph = graphForNavigation(hierarchy, app.graphNavigation);
      await loadGraph(graph, { selectedId: target.file });
      if (app.renderState?.nodes.some((n) => n.id === target.file)) {
        focusCameraOnNodeAnimated(app.renderState, canvas, target.file, draw);
        setHighlight(target.file);
      }
    }
    persist();
  }


  window.addEventListener("resize", resize);

  let pendingPopupTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPendingPopup() {
    if (pendingPopupTimer != null) {
      clearTimeout(pendingPopupTimer);
      pendingPopupTimer = null;
    }
  }

  let viewPersistTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleViewPersist(): void {
    if (viewPersistTimer) clearTimeout(viewPersistTimer);
    viewPersistTimer = setTimeout(() => {
      viewPersistTimer = null;
      persist();
    }, 800);
  }

  attachInteraction(canvas, () => app.renderState, {
    onChange: () => {
      draw();
    },
    onViewSettled: () => {
      scheduleViewPersist();
    },
    onSelect: (id) => {
      if (app.renderState) {
        app.renderState.selectedId = id;
      }
    },
    onHover: (id) => {
      if (!app.renderState) return;
      setHighlight(id);
    },
    onNodeClick: (id) => {
      clearPendingPopup();
      if (!id) {
        hideModuleOverlays();
        setHighlight(null);
        persist();
        return;
      }
      // Delay so a double-click can cancel and drill instead of flashing the popup.
      pendingPopupTimer = setTimeout(() => {
        pendingPopupTimer = null;
        openModuleDetails(id);
      }, 220);
    },
    onNodeDoubleClick: (id) => {
      clearPendingPopup();
      hideModuleOverlays();
      const level =
        app.graphNavigation.crumbs[app.graphNavigation.crumbs.length - 1]
          ?.level;
      if (level === "symbols") {
        void openSymbolSource(id);
        return;
      }
      const node = app.renderState?.nodes.find((n) => n.id === id);
      if (
        node &&
        node.kind !== "package" &&
        node.kind !== "file" &&
        node.kind !== "folder" &&
        (node.line ?? 0) > 0
      ) {
        void openSymbolSource(id);
        return;
      }
      if (node?.kind === "file") {
        void handleFileOpen(node.path || node.id);
        return;
      }
      drillIntoNode(id);
    },
  });

  canvas.addEventListener("mouseleave", () => {
    setHighlight(null);
  });

  async function handleOpenProject() {
    let path = await openProjectDialog();

    if (!path) {
      const input = document.createElement("input");
      input.type = "file";
      input.setAttribute("webkitdirectory", "");
      input.style.display = "none";
      document.body.appendChild(input);

      path = await new Promise<string | null>((resolve) => {
        input.addEventListener("change", () => {
          const files = input.files;
          if (!files || files.length === 0) {
            resolve(null);
            return;
          }
          const first = files[0];
          const rel = first.webkitRelativePath;
          const root = rel.split("/")[0];
          resolve(root || first.name);
        });
        input.click();
      });
      document.body.removeChild(input);
    }

    if (!path) return;

    btnOpen.disabled = true;
    await openProjectAt(path);
    btnOpen.disabled = false;
  }

  function startAnalysisRun(): void {
    if (!app.projectPath) return;
    const linterSettings = ensureLinterSettings(
      app.linterSettings,
      lintersState.groups.length > 0 ? lintersState.groups : undefined,
    );
    app.linterSettings = linterSettings;
    lintersState.settings = linterSettings;

    dismissRunDialogs();
    showProgressView();

    analysisManager.start({
      projectPath: app.projectPath,
      rules: Array.from(app.selectedRules).map((id) => {
        const rule = rulesState.rules.find((r) => r.id === id);
        return { id, name: rule?.name ?? id };
      }),
      ruleSettings: app.ruleSettings,
      lspSettings: app.lspSettings,
      linterSettings,
      llmConfigurations: app.llmConfigurations,
      aiValidationRuntime: app.aiValidationRuntime,
      designRules: app.designRules,
    });
  }

  function updateRunButtonHint(): void {
    const parts: string[] = [t("overlay.runAnalysis")];
    if (app.analysisTriggers.watchEnabled) parts.push(t("boot.watchingFiles"));
    if (app.analysisTriggers.scheduleEnabled) parts.push(t("boot.scheduled"));
    btnRun.title = parts.join(" · ");
  }

  async function applyRunChoice(
    choice: NonNullable<Awaited<ReturnType<typeof showAnalysisDialog>>>,
  ): Promise<void> {
    if (!app.projectPath) return;

    if (choice.mode === "now") {
      // Manual one-shot does not change persistent triggers.
      startAnalysisRun();
      return;
    }

    if (choice.mode === "watch") {
      app.analysisTriggers = {
        ...app.analysisTriggers,
        watchEnabled: true,
        watchDebounceMs: choice.debounceMs,
      };
      await startAnalysisWatch(app.projectPath, choice.debounceMs);
      // Disable schedule if enabling watch-only from this dialog path? Keep both allowed.
    } else if (choice.mode === "schedule") {
      app.analysisTriggers = {
        ...app.analysisTriggers,
        scheduleEnabled: true,
        cron: choice.cron,
      };
      await startAnalysisSchedule(app.projectPath, choice.cron);
    }

    persist();
    updateRunButtonHint();

    if (choice.runImmediately) {
      startAnalysisRun();
    }
  }

  async function handleRunAnalysis() {
    if (!app.projectPath) return;
    if (rulesState.loading || rulesState.rules.length === 0) {
      await initRulesPanel();
    }
    if (app.selectedRules.size === 0) {
      settingsApi.open("rules");
      showOverlay(
        t("overlay.selectRulesTitle"),
        t("overlay.selectRulesDetail"),
      );
      return;
    }

    if (analysisManager.hasRunning()) {
      startAnalysisRun();
      return;
    }

    const choice = await showAnalysisDialog(app.selectedRules.size, {
      defaults: {
        mode: "now",
        debounceMs: app.analysisTriggers.watchDebounceMs,
        cron: app.analysisTriggers.cron,
        runImmediately: true,
      },
      onConfigureRules: () => {
        settingsApi.open("rules");
      },
    });
    if (!choice) return;
    dismissRunDialogs();

    try {
      await applyRunChoice(choice);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  // Auto-triggers from Rust (watch / cron)
  void listenAnalysisTriggers((event) => {
    if (!app.projectPath || event.projectPath !== app.projectPath) return;
    if (app.selectedRules.size === 0) return;
    if (analysisManager.hasRunning()) return;
    startAnalysisRun();
  });

  async function restoreAnalysisTriggers(projectPath: string): Promise<void> {
    try {
      if (app.analysisTriggers.watchEnabled) {
        await startAnalysisWatch(
          projectPath,
          app.analysisTriggers.watchDebounceMs,
        );
      } else {
        await stopAnalysisWatch();
      }
      if (app.analysisTriggers.scheduleEnabled) {
        await startAnalysisSchedule(projectPath, app.analysisTriggers.cron);
      } else {
        await stopAnalysisSchedule();
      }
    } catch (err) {
      console.warn("Failed to restore analysis triggers:", err);
    }
    updateRunButtonHint();
  }

  btnOpen.addEventListener("click", handleOpenProject);
  btnRun.addEventListener("click", handleRunAnalysis);
  btnStop.addEventListener("click", () => {
    analysisManager.cancelAll();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      if (fileViewer.isOpen() && fileViewer.isDirty()) {
        e.preventDefault();
        void fileViewer.save();
      }
    }
  });

  renderProjectTree(treeContainer, null, { onFileOpen: handleFileOpen });
  refreshModulesList();
  applyShellI18n();
  onLocaleChange((locale) => {
    uiLocale = locale;
  });

  async function launchSetupWizard(): Promise<void> {
    if (setupWizardOpen) return;
    setupWizardOpen = true;
    try {
      if (app.llmProviders.length === 0) {
        try {
          app.llmProviders = await getLlmProviders();
          llmProviderConfigsPanel.setProviders(app.llmProviders);
        } catch (err) {
          console.warn("Failed to load LLM providers for setup wizard:", err);
        }
      }

      const result = await showSetupWizard({
        openProject: async () => {
          let path = await openProjectDialog();
          if (!path) {
            // Same browser fallback as the toolbar Open button.
            const input = document.createElement("input");
            input.type = "file";
            input.setAttribute("webkitdirectory", "");
            input.style.display = "none";
            document.body.appendChild(input);
            path = await new Promise<string | null>((resolve) => {
              input.addEventListener("change", () => {
                const files = input.files;
                if (!files || files.length === 0) {
                  resolve(null);
                  return;
                }
                const first = files[0]!;
                const rel = first.webkitRelativePath;
                const root = rel.split("/")[0];
                resolve(root || first.name);
              });
              input.click();
            });
            document.body.removeChild(input);
          }
          if (!path) return null;
          const ok = await openProjectAt(path);
          return ok ? path : null;
        },
        getProjectPath: () => app.projectPath,
        listLspServers: async () => {
          const list = await fetchLspServers();
          lspState.servers = list;
          lspState.settings = mergeLspSettings(list, lspState.settings);
          app.lspSettings = lspState.settings;
          lspLoaded = true;
          createLspServersPanel(lspServersContainer, lspState, lspHandlers);
          persist();
          return list;
        },
        installLspServer: async (id) => {
          const result = await runInstallLspServer(id);
          if (result.ok) {
            lspState.servers = await fetchLspServers();
            lspState.settings = mergeLspSettings(
              lspState.servers,
              lspState.settings,
            );
            app.lspSettings = lspState.settings;
            createLspServersPanel(lspServersContainer, lspState, lspHandlers);
            persist();
          }
          return result;
        },
        getLspSettings: () => app.lspSettings,
        setLspSettings: (settings) => {
          app.lspSettings = settings;
          lspState.settings = settings;
          persist();
        },
        getGitleaksStatus: () => getGitleaksStatus(),
        installGitleaks: () => installGitleaks(),
        getTrufflehogStatus: () => getTrufflehogStatus(),
        installTrufflehog: () => installTrufflehog(),
        onSecretScannerInstalled: (id) => {
          if (id === "gitleaks") {
            void refreshGitleaksStatus();
            app.selectedRules.add("gitleaks");
            rulesState.selected = new Set(app.selectedRules);
          } else {
            void refreshTrufflehogStatus();
            app.selectedRules.add("trufflehog");
            rulesState.selected = new Set(app.selectedRules);
          }
          renderRulesPanel();
          persist();
        },
        getLlmProviders: () => app.llmProviders,
        listLlmModels: (provider, apiKey) => listLlmModels(provider, apiKey),
        probeCliLlmBackend: (provider) => probeCliLlmBackend(provider),
        getLlmConfigurations: () => app.llmConfigurations,
        setLlmConfigurations: (configs) => {
          app.llmConfigurations = configs;
          llmProviderConfigsPanel.setConfigs(configs);
          persist();
        },
      });

      setupWizardCompleted = true;
      persist();

      if (!app.projectPath) {
        showGuidedOverlay();
      }

      if (result.action === "runAnalysis" && app.projectPath) {
        await handleRunAnalysis();
      }
    } finally {
      setupWizardOpen = false;
    }
  }

  if (!persisted.projectPath) {
    showGuidedOverlay();
    if (!setupWizardCompleted) {
      void launchSetupWizard();
    }
  } else {
    projectPathEl.textContent = t("boot.restoringSession");
    runWhenIdleAsync(async () => {
      const ok = await openProjectAt(persisted.projectPath!);
      if (!ok) return;

      // Only restore analysis that belongs to this project (never another folder).
      const projectRoot = app.projectPath ?? persisted.projectPath!;
      const [meta, quality] = await Promise.all([
        loadPersistedAnalysisMeta(projectRoot),
        loadPersistedAnalysisQuality(projectRoot),
      ]);
      if (!meta) return;
      if (
        meta.projectRoot &&
        meta.projectRoot.replace(/\\/g, "/").replace(/\/+$/, "") !==
          projectRoot.replace(/\\/g, "/").replace(/\/+$/, "")
      ) {
        return;
      }

      const emptyHierarchy: HierarchyIndex = {
        files: [],
        packages: [],
        file_imports: {},
        package_edges: [],
        symbols: {},
        symbol_edges: [],
      };

      app.analysisResult = {
        ...meta,
        hierarchy: emptyHierarchy,
        quality: quality ?? null,
      };
      // Restore to package root so we can paint the slim graph without hierarchy.
      app.graphNavigation = rootNavigation();
      resultsPanel.setResult(app.analysisResult);
      showReportView();

      if (meta.graph?.nodes?.length) {
        try {
          await loadGraph(meta.graph, {
            visibleIds: persisted.visibleModuleIds,
            camera: persisted.camera,
            selectedId: persisted.selectedNodeId,
          });
        } catch (err) {
          console.warn("Restore package graph layout failed", err);
        }
      }
    });
  }
}

