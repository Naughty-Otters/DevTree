import { computeLayout, parseLayoutMode, type LayoutMode } from "./wasm-bridge";
import { render, createRenderState, type RenderState } from "./canvas/renderer";
import { attachInteraction } from "./canvas/interaction";
import { fitCameraToContent, focusCameraOnNodeAnimated, focusCameraOnNodesAnimated } from "./canvas/camera";
import {
  animateLayoutTransition,
  animateVisibilityTransition,
} from "./canvas/layoutTransition";
import { parseEdgeStyle, type EdgeStyle } from "./canvas/edgeStyle";
import type { Graph } from "./graph/types";
import {
  parseModuleFilters,
  visibleIdsForFilters,
  type ModuleFilterFlags,
} from "./graph/moduleFilters";
import { hierarchyFromGraph } from "./graph/hierarchy";
import type { AnalysisResult, CycleGroup } from "./analysis/types";
import { mergeRuleSettings, type RuleSettingsMap } from "./analysis/types";
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
  readProjectFile,
  writeProjectFile,
  listLspServers as fetchLspServers,
  installLspServer as runInstallLspServer,
  listLlmModels,
  listLanguageLinters,
  installLinter,
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
import { showSetupWizard } from "./ui/setupWizard";
import {
  defaultAnalysisTriggerConfig,
  type AnalysisTriggerConfig,
} from "./analysis/triggers";
import { initTooltips } from "./ui/tooltip";
import { hideGraphPopup, isGraphPopupOpen } from "./ui/graphPopup";
import { createModuleDetailsPanel } from "./ui/moduleDetailsPanel";
import { renderGraphNav } from "./ui/graphNav";
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
import { isOpenableValidationPath } from "./validation/parseAffected";
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
  loadPersistedAnalysisMeta,
  loadPersistedAnalysisQuality,
  loadPersistedUiState,
  scheduleSaveAnalysis,
  scheduleSaveUiState,
} from "./state/store";
import {
  parsePercentileViewMode,
  type PercentileViewMode,
} from "./analysis/percentileView";
import { applyPanelSizes, readPanelSizes } from "./state/panels";
import { runWhenIdle, runWhenIdleAsync } from "./lazy/defer";
import { loadAnalysisRules } from "./lazy/rules";
import { clearHierarchyLoadCache, loadAnalysisHierarchy } from "./lazy/hierarchy";
import { clearQualityLoadCache, loadAnalysisQuality } from "./lazy/quality";

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
  centerView: "graph" | "dsm" | "file";
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
  const btnFocus = document.querySelector<HTMLButtonElement>("#btn-focus-view")!;
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
  const graphOverlay = document.querySelector<HTMLElement>("#graph-overlay")!;
  const graphOverlayText = document.querySelector<HTMLElement>("#graph-overlay-text")!;
  const fileViewerEl = document.querySelector<HTMLElement>("#file-viewer")!;
  const dsmViewEl = document.querySelector<HTMLElement>("#dsm-view")!;
  const graphNavContainer = document.querySelector<HTMLElement>("#graph-nav")!;
  const viewTabs = document.querySelector<HTMLElement>("#view-tabs")!;
  const moduleDetailsPanelEl =
    document.querySelector<HTMLElement>("#module-details-panel")!;

  const persisted = await loadPersistedUiState();
  applyPanelSizes(persisted.panelSizes);

  const initialLinterSettings = ensureLinterSettings(persisted.linterSettings);
  let layoutMode: LayoutMode = parseLayoutMode(persisted.layoutMode);
  let moduleFilters: ModuleFilterFlags = parseModuleFilters(persisted.moduleFilters);
  let edgeStyle: EdgeStyle = parseEdgeStyle(persisted.edgeStyle);
  let percentileView: PercentileViewMode = parsePercentileViewMode(
    persisted.percentileView,
  );

  const rulesState: RulesPanelState = {
    rules: [],
    selected: new Set(persisted.selectedRuleIds),
    settings: persisted.ruleSettings,
    expandedRuleId: null,
    loading: true,
    loadError: null,
  };

  const migratedAi = migratePersistedAiSettings(persisted);
  let setupWizardCompleted = Boolean(persisted.setupWizardCompleted);
  let setupWizardOpen = false;

  function rulesPanelContext(): RulesPanelContext {
    return {
      llmProviders: app.llmProviders,
      llmConfigurations: app.llmConfigurations,
    };
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
      focusModuleOnGraph(nodeId);
      openModuleDetails(nodeId);
    },
    onOpenContent: (nodeId) => {
      if (app.renderState?.nodes.some((node) => node.id === nodeId)) {
        focusModuleOnGraph(nodeId);
        openModuleDetails(nodeId);
        return;
      }
      // Contents live one level deeper — open that level on the graph.
      const parentId = moduleDetailsPanel.currentNodeId();
      if (parentId) drillIntoNode(parentId);
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

      rulesState.rules = rules;
      rulesState.selected = selected;
      rulesState.settings = mergeRuleSettings(rules, persisted.ruleSettings);
      rulesState.loading = false;
      app.selectedRules = rulesState.selected;
      app.ruleSettings = rulesState.settings;
      renderRulesPanel();
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
      }
    },
    onRunFailed: (run) => {
      console.error(run.error);
      alert(`Analysis failed: ${run.error}`);
    },
  });

  resultsPanel = createResultsPanel(resultsContainer, {
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
    onShowModuleOnGraph: (nodeId) => {
      void showModuleOnGraph(nodeId);
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
  });

  async function applyAnalysisResult(result: AnalysisResult): Promise<void> {
    clearHierarchyLoadCache();
    clearQualityLoadCache();
    if (!result.dsm && result.hierarchy) {
      result = { ...result, dsm: computeDsm(result.hierarchy) };
    }
    if (result.hierarchy && app.designRules.length > 0) {
      const violations = checkDesignRules(result.hierarchy, app.designRules);
      if (result.dsm) {
        result = {
          ...result,
          dsm: { ...result.dsm, violations },
        };
      }
      const item = designRulesValidationItem(violations);
      const without = result.validation.filter(
        (v) => v.rule_id !== "architecture_conformance",
      );
      result = { ...result, validation: [...without, item] };
    }
    app.analysisResult = result;
    app.hierarchy = result.hierarchy;
    app.graphNavigation = rootNavigation();
    resultsPanel.setResult(result);
    resultsPanel.showTab("analysis");
    persist();
    persistAnalysis();
    refreshDsmView();
    // Prefetch repo-wide git churn off the click path.
    void ensureProjectChurnLoaded();
    runWhenIdle(() => {
      void navigateGraph();
    }, 1500);
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

  async function ensureAnalysisHierarchy(): Promise<HierarchyIndex | null> {
    if (hierarchyIsHydrated(app.hierarchy)) {
      return app.hierarchy;
    }
    if (!app.analysisResult) return null;

    if (hierarchyIsHydrated(app.analysisResult.hierarchy)) {
      app.hierarchy = app.analysisResult.hierarchy;
      return app.hierarchy;
    }

    if (app.hierarchyLoading) {
      return app.hierarchy;
    }

    app.hierarchyLoading = true;
    showOverlay("Loading dependency graph…");
    try {
      const hierarchy = await loadAnalysisHierarchy(app.analysisResult);
      if (hierarchy && hierarchyIsHydrated(hierarchy)) {
        app.hierarchy = hierarchy;
        app.analysisResult = { ...app.analysisResult, hierarchy };
        return hierarchy;
      }

      if (app.analysisResult.graph?.nodes?.length) {
        const rebuilt = hierarchyFromGraph(app.analysisResult.graph);
        app.hierarchy = rebuilt;
        app.analysisResult = { ...app.analysisResult, hierarchy: rebuilt };
        return rebuilt;
      }

      return null;
    } finally {
      app.hierarchyLoading = false;
      if (app.hierarchy) {
        hideOverlay();
      }
    }
  }

  function refreshFileNav(path: string) {
    const issues = collectFileIssues(app.analysisResult, path);
    renderFileNav(graphNavContainer, {
      path,
      issues,
      onIssueClick: (line) => fileViewer.scrollToLine(line),
    });
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
      setupWizardCompleted,
    };
  }

  function persist(): void {
    scheduleSaveUiState(collectUiState());
  }

  function persistAnalysis(): void {
    scheduleSaveAnalysis(app.analysisResult);
  }

  function setActiveViewTab(view: "graph" | "dsm" | "file"): void {
    viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === view);
    });
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

  function renderDesignRulesPanel(): void {
    createDesignRulesPanel(designRulesContainer, app.designRules, {
      packageIds: app.hierarchy?.packages ?? app.analysisResult?.hierarchy?.packages ?? [],
      onChange: (rules) => {
        app.designRules = rules;
        persist();
        recheckDesignRulesInPlace();
      },
      onSuggestLayers: () => {
        const hierarchy = app.hierarchy ?? app.analysisResult?.hierarchy;
        if (!hierarchy) {
          alert("Run analysis first to suggest layers from the DSM.");
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
    fileViewerEl.classList.add("hidden");
    dsmViewEl.classList.add("hidden");
    canvas.classList.remove("hidden");
    setActiveViewTab("graph");
    void ensureAnalysisHierarchy().then((hierarchy) => {
      if (!hierarchy) return;
      const graph = graphForNavigation(hierarchy, app.graphNavigation);
      refreshGraphNav(graph);
    });
  }

  function showDsmView() {
    app.centerView = "dsm";
    fileViewerEl.classList.add("hidden");
    canvas.classList.add("hidden");
    dsmViewEl.classList.remove("hidden");
    setActiveViewTab("dsm");
    void ensureAnalysisHierarchy().then((hierarchy) => {
      if (hierarchy) {
        app.hierarchy = hierarchy;
      }
      refreshDsmView();
      refreshGraphNav();
    });
  }

  function showFileView() {
    app.centerView = "file";
    fileViewerEl.classList.remove("hidden");
    canvas.classList.add("hidden");
    dsmViewEl.classList.add("hidden");
    setActiveViewTab("file");
    const path = fileViewer.getPath();
    if (path) refreshFileNav(path);
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
      if (tab.dataset.view === "graph") showGraphView();
      else if (tab.dataset.view === "dsm") showDsmView();
      else if (fileViewer.isOpen()) showFileView();
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

  function setHighlight(nodeId: string | null) {
    if (!app.renderState) return;
    if (nodeId === null && (isGraphPopupOpen() || moduleDetailsPanel.isOpen())) {
      return;
    }
    app.renderState.highlightCycle = undefined;
    app.renderState.highlightId = nodeId;
    modulesContainer.querySelectorAll<HTMLElement>(".module-row").forEach((row) => {
      row.classList.toggle("module-row-active", row.dataset.nodeId === nodeId);
    });
    draw();
  }

  function refreshGraphNav(graph?: Graph) {
    if (!app.hierarchy) {
      graphNavContainer.innerHTML = "";
      return;
    }

    renderGraphNav(
      graphNavContainer,
      app.graphNavigation,
      canGoBack(app.graphNavigation),
      canGoForward(app.graphNavigation),
      {
        onBack: () => {
          hideModuleOverlays();
          app.graphNavigation = goBack(app.graphNavigation);
          void navigateGraph();
        },
        onForward: () => {
          hideModuleOverlays();
          app.graphNavigation = goForward(app.graphNavigation);
          void navigateGraph();
        },
        onNavigate: (crumb) => {
          hideModuleOverlays();
          app.graphNavigation = navigateTo(app.graphNavigation, crumb);
          void navigateGraph({ skipAutoAdvance: true });
        },
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
          if (app.renderState) {
            void applyVisibilityThenReorganize(
              visibleIdsForFilters(
                app.renderState.nodes,
                app.renderState.edges,
                moduleFilters,
              ),
            );
          } else {
            persist();
          }
        },
      },
      {
        stats: graph
          ? { nodes: graph.nodes.length, edges: graph.edges.length }
          : undefined,
        staleImports: hasStaleImportIndex(app.hierarchy),
        layoutMode,
        edgeStyle,
        moduleFilters,
      },
    );
  }

  async function navigateGraph(opts?: {
    visibleIds?: string[];
    camera?: PersistedAppState["camera"];
    selectedId?: string | null;
    skipAutoAdvance?: boolean;
  }) {
    const hierarchy = await ensureAnalysisHierarchy();
    if (!hierarchy) {
      if (!app.analysisResult) {
        showOverlay("Run analysis to build the dependency graph");
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
    refreshGraphNav(graph);
    if (app.centerView === "dsm") {
      refreshDsmView();
    }
  }

  function drillIntoNode(nodeId: string) {
    if (!app.renderState || !app.hierarchy) return;
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

    try {
      const content = await readProjectFile(app.projectPath, node.path);
      fileViewer.open(node.path, content, {
        line: node.line && node.line > 0 ? node.line : undefined,
        issues: collectFileIssues(app.analysisResult, node.path),
      });
      refreshFileNav(node.path);
      showFileView();
    } catch (err) {
      console.error(err);
      alert(`Could not open file: ${err}`);
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
    // Metrics are precomputed on analysis; click path is O(1) lookup + DOM.
    moduleDetailsPanel.show({
      node,
      nodes: app.renderState.nodes,
      edges: app.renderState.edges,
      hierarchy: app.hierarchy,
      navigation: app.graphNavigation,
      analysis: app.analysisResult,
      churn: projectChurnCache,
    });
    persist();
    if (!projectChurnCache) {
      void ensureProjectChurnLoaded();
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

  function refreshModulesList() {
    renderModulesList(modulesContainer, app.modulesListState, {
      onFocus: (nodeId) => {
        if (!app.renderState) return;
        focusCameraOnNodeAnimated(app.renderState, canvas, nodeId, draw);
        draw();
        persist();
      },
      onVisibilityChange: (visibleIds) => {
        app.modulesListState.visibleIds = visibleIds;
        syncHiddenFromVisible();
      },
      onHighlight: setHighlight,
      onShowDetails: (nodeId) => {
        showGraphView();
        focusModuleOnGraph(nodeId);
        openModuleDetails(nodeId);
      },
    });
  }

  function showOverlay(text: string) {
    graphOverlayText.textContent = text;
    graphOverlay.classList.remove("hidden");
  }

  function hideOverlay() {
    graphOverlay.classList.add("hidden");
  }

  function draw() {
    if (!app.renderState) return;
    render(ctx, canvas, app.renderState);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    draw();
  }

  async function loadGraph(
    graph: Graph,
    opts?: { visibleIds?: string[]; camera?: PersistedAppState["camera"]; selectedId?: string | null },
  ) {
    hideModuleOverlays();
    showOverlay("Computing layout…");
    const positionsList = await computeLayout(graph, layoutMode);
    const positions = new Map(positionsList.map((p) => [p.id, p]));

    app.renderState = createRenderState(graph.nodes, graph.edges, positions);
    app.renderState.edgeStyle = edgeStyle;

    const filterVisible = visibleIdsForFilters(
      graph.nodes,
      graph.edges,
      moduleFilters,
    );
    const visible =
      opts?.visibleIds && opts.visibleIds.length > 0
        ? new Set(opts.visibleIds.filter((id) => filterVisible.has(id)))
        : filterVisible;
    app.modulesListState.graphNodes = graph.nodes;
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

    hideOverlay();
    draw();
    refreshModulesList();
    btnFocus.disabled = false;
    persist();
  }

  function clearMainPanel(): void {
    hideModuleOverlays();
    fileViewer.close();
    showGraphView();
    clearHierarchyLoadCache();
    clearQualityLoadCache();
    projectChurnCache = null;
    projectChurnPromise = null;

    app.analysisResult = null;
    app.hierarchy = null;
    app.graphNavigation = rootNavigation();
    app.renderState = null;
    app.modulesListState = {
      graphNodes: [],
      visibleIds: new Set(),
      searchQuery: app.modulesListState.searchQuery,
    };

    resultsPanel.setResult(null);
    refreshModulesList();
    graphNavContainer.innerHTML = "";
    btnFocus.disabled = true;

    const ctx2d = canvas.getContext("2d");
    if (ctx2d) {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = "#0f1115";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    }
    showOverlay("Run analysis to build the dependency graph");
  }

  async function openProjectAt(path: string): Promise<boolean> {
    try {
      projectPathEl.textContent = "Scanning…";
      const scan = await scanProject(path);

      // Always refresh the main panel when (re)opening a project so the
      // previous project's graph/results don't linger.
      clearMainPanel();

      app.projectPath = scan.root;
      app.projectScan = scan;
      projectChurnCache = null;
      projectChurnPromise = null;
      void ensureProjectChurnLoaded();

      const displayPath = scan.root.split("/").pop() ?? scan.root;
      projectPathEl.textContent = displayPath;
      projectPathEl.title = scan.root;

      renderProjectTree(treeContainer, scan.tree, {
        onFileOpen: handleFileOpen,
      });
      refreshModulesList();
      btnRun.disabled = false;
      persist();
      await restoreAnalysisTriggers(scan.root);
      return true;
    } catch (err) {
      console.error(err);
      projectPathEl.textContent = "Failed to open project";
      return false;
    }
  }

  async function handleFileOpen(relativePath: string, line?: number) {
    if (!app.projectPath) return;
    try {
      const content = await readProjectFile(app.projectPath, relativePath);
      const issues = collectFileIssues(app.analysisResult, relativePath);
      fileViewer.open(relativePath, content, {
        line: line && line > 0 ? line : undefined,
        issues,
      });
      refreshFileNav(relativePath);
      showFileView();
    } catch (err) {
      console.error(err);
      alert(`Could not open file: ${err}`);
    }
  }

  async function openValidationTarget(target: ValidationNavTarget) {
    hideValidationDetail();
    if (!isOpenableValidationPath(target.file)) {
      return;
    }
    await handleFileOpen(target.file, target.line);
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

    showGraphView();

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
    const parts: string[] = ["Run analysis"];
    if (app.analysisTriggers.watchEnabled) parts.push("watching files");
    if (app.analysisTriggers.scheduleEnabled) parts.push("scheduled");
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
      alert("Select at least one analysis rule.");
      return;
    }

    if (analysisManager.hasRunning()) {
      startAnalysisRun();
      return;
    }

    const choice = await showAnalysisDialog(app.selectedRules.size, {
      mode: "now",
      debounceMs: app.analysisTriggers.watchDebounceMs,
      cron: app.analysisTriggers.cron,
      runImmediately: true,
    });
    if (!choice) return;

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
  btnFocus.addEventListener("click", () => {
    void reorganizeVisibleLayout();
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
  mountToolbarIcons();
  initTooltips();

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
        getLlmProviders: () => app.llmProviders,
        listLlmModels: (provider, apiKey) => listLlmModels(provider, apiKey),
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
        showOverlay("Open a project to get started");
      }

      if (result.action === "runAnalysis" && app.projectPath) {
        await handleRunAnalysis();
      }
    } finally {
      setupWizardOpen = false;
    }
  }

  if (!persisted.projectPath) {
    showOverlay("Open a project to get started");
    if (!setupWizardCompleted) {
      void launchSetupWizard();
    }
  } else {
    projectPathEl.textContent = "Restoring session…";
    runWhenIdleAsync(async () => {
      const ok = await openProjectAt(persisted.projectPath!);
      if (!ok) return;

      const [meta, quality] = await Promise.all([
        loadPersistedAnalysisMeta(),
        loadPersistedAnalysisQuality(),
      ]);
      if (!meta) return;

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
      app.graphNavigation = persisted.graphNavigation ?? rootNavigation();
      resultsPanel.setResult(app.analysisResult);

      // Hydrate heavy hierarchy (and quality fallback) off the critical path.
      runWhenIdle(() => {
        void (async () => {
          const hierarchy = await ensureAnalysisHierarchy();
          if (!app.analysisResult) return;

          if (!app.analysisResult.quality) {
            const loaded = await loadAnalysisQuality(app.analysisResult);
            if (loaded) {
              app.analysisResult = { ...app.analysisResult, quality: loaded };
            }
          }

          if (hierarchy && !app.analysisResult.dsm) {
            const dsm = computeDsm(hierarchy);
            app.analysisResult = { ...app.analysisResult, dsm };
          }

          resultsPanel.setResult(app.analysisResult);
          void navigateGraph({
            visibleIds: persisted.visibleModuleIds,
            camera: persisted.camera,
            selectedId: persisted.selectedNodeId,
          }).then(() => {
            refreshDsmView();
          });
        })();
      }, 3000);
    });
  }
}

