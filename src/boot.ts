import { computeLayout } from "./wasm-bridge";
import { render, createRenderState, type RenderState } from "./canvas/renderer";
import { attachInteraction } from "./canvas/interaction";
import { fitCameraToContent, focusCameraOnNodeAnimated, focusCameraOnNodesAnimated } from "./canvas/camera";
import type { Graph } from "./graph/types";
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
  listLspServers,
  installLspServer,
  listLanguageLinters,
  installLinter,
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
import { createLlmProviderConfigsPanel } from "./ui/llmProviderConfigsPanel";
import { createLlmRuntimeSettingsPanel } from "./ui/llmRuntimeSettingsPanel";
import { createLazyFileViewer } from "./lazy/fileViewer";
import { mountToolbarIcons } from "./ui/toolbar";
import { createSettingsPanel } from "./ui/settingsPanel";
import { initResizers } from "./ui/resizer";
import { showAnalysisDialog } from "./ui/analysisDialog";
import { initTooltips } from "./ui/tooltip";
import { hideGraphPopup, isGraphPopupOpen, toggleGraphPopup } from "./ui/graphPopup";
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
import { loadPersistedAnalysisMeta, loadPersistedUiState, scheduleSaveAnalysis, scheduleSaveUiState } from "./state/store";
import { applyPanelSizes, readPanelSizes } from "./state/panels";
import { runWhenIdle, runWhenIdleAsync } from "./lazy/defer";
import { loadAnalysisRules } from "./lazy/rules";
import { clearHierarchyLoadCache, loadAnalysisHierarchy } from "./lazy/hierarchy";

interface AppState {
  projectPath: string | null;
  projectScan: ProjectScan | null;
  selectedRules: Set<string>;
  ruleSettings: RuleSettingsMap;
  lspSettings: LspSettingsMap;
  linterSettings: LinterSettingsMap;
  llmConfigurations: LlmConfiguration[];
  aiValidationRuntime: AiValidationRuntimeSettings;
  llmProviders: LlmProviderInfo[];
  analysisResult: AnalysisResult | null;
  hierarchy: HierarchyIndex | null;
  graphNavigation: GraphNavigation;
  renderState: RenderState | null;
  modulesListState: ModulesListState;
  hierarchyLoading: boolean;
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
  const btnFocus = document.querySelector<HTMLButtonElement>("#btn-focus-view")!;
  const btnSaveFile = document.querySelector<HTMLButtonElement>("#btn-save-file")!;
  const btnSettings = document.querySelector<HTMLButtonElement>("#btn-settings")!;
  const projectPathEl = document.querySelector<HTMLElement>("#project-path")!;
  const treeContainer = document.querySelector<HTMLElement>("#project-tree")!;
  const modulesContainer = document.querySelector<HTMLElement>("#modules-list")!;
  const rulesContainer = document.querySelector<HTMLElement>("#rules-panel")!;
  const lspServersContainer = document.querySelector<HTMLElement>("#lsp-servers-panel")!;
  const lintersContainer = document.querySelector<HTMLElement>("#linters-panel")!;
  const settingsOverlay = document.querySelector<HTMLElement>("#settings-overlay")!;
  const resultsContainer = document.querySelector<HTMLElement>("#results-panel")!;
  const llmProviderConfigsContainer = document.querySelector<HTMLElement>(
    "#llm-provider-configs-panel",
  )!;
  const llmRuntimeSettingsContainer = document.querySelector<HTMLElement>(
    "#llm-runtime-settings-panel",
  )!;
  const graphOverlay = document.querySelector<HTMLElement>("#graph-overlay")!;
  const graphOverlayText = document.querySelector<HTMLElement>("#graph-overlay-text")!;
  const fileViewerEl = document.querySelector<HTMLElement>("#file-viewer")!;
  const graphNavContainer = document.querySelector<HTMLElement>("#graph-nav")!;
  const viewTabs = document.querySelector<HTMLElement>("#view-tabs")!;

  const persisted = await loadPersistedUiState();
  applyPanelSizes(persisted.panelSizes);

  const initialLinterSettings = ensureLinterSettings(persisted.linterSettings);

  const rulesState: RulesPanelState = {
    rules: [],
    selected: new Set(persisted.selectedRuleIds),
    settings: persisted.ruleSettings,
    expandedRuleId: null,
    loading: true,
    loadError: null,
  };

  const migratedAi = migratePersistedAiSettings(persisted);

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
  };

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
    app.analysisResult = result;
    app.hierarchy = result.hierarchy;
    app.graphNavigation = rootNavigation();
    resultsPanel.setResult(result);
    persist();
    persistAnalysis();
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
      projectPath: app.projectPath,
      selectedRuleIds: Array.from(app.selectedRules),
      ruleSettings: app.ruleSettings,
      lspSettings: app.lspSettings,
      linterSettings: app.linterSettings,
      llmConfigurations: app.llmConfigurations,
      aiValidationRuntime: app.aiValidationRuntime,
      visibleModuleIds: Array.from(app.modulesListState.visibleIds),
      selectedNodeId: app.renderState?.selectedId ?? null,
      camera: app.renderState
        ? { ...app.renderState.camera }
        : null,
      graphNavigation: serializeNavigation(app.graphNavigation),
    };
  }

  function persist(): void {
    scheduleSaveUiState(collectUiState());
  }

  function persistAnalysis(): void {
    scheduleSaveAnalysis(app.analysisResult);
  }

  function showGraphView() {
    fileViewerEl.classList.add("hidden");
    canvas.classList.remove("hidden");
    viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === "graph");
    });
    void ensureAnalysisHierarchy().then((hierarchy) => {
      if (!hierarchy) return;
      const graph = graphForNavigation(hierarchy, app.graphNavigation);
      refreshGraphNav(graph);
    });
  }

  function showFileView() {
    fileViewerEl.classList.remove("hidden");
    canvas.classList.add("hidden");
    viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === "file");
    });
    const path = fileViewer.getPath();
    if (path) refreshFileNav(path);
  }

  viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.view === "graph") showGraphView();
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
        lspState.servers = await listLspServers();
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
        const result = await installLspServer(id);
        lspState.servers = lspState.servers.map((s) =>
          s.id === id ? result.server : s,
        );
        if (!result.ok) {
          lspState.errors[id] = result.message;
        } else {
          lspState.servers = await listLspServers();
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

  settingsApi = createSettingsPanel(settingsOverlay, () => {
    requestAnimationFrame(() => {
      if (rulesState.loading || rulesState.rules.length === 0) {
        void initRulesPanel();
      }
      if (!lspLoaded) void lspHandlers.onRefresh();
      if (!lintersLoaded) void lintersHandlers.onRefresh();
    });
  });
  btnSettings.addEventListener("click", () => settingsApi.toggle());

  initResizers(
    () => resize(),
    () => persist(),
  );

  function syncHiddenFromVisible() {
    if (!app.renderState) return;
    const allIds = new Set(app.renderState.nodes.map((n) => n.id));
    app.renderState.hiddenIds = new Set(
      [...allIds].filter((id) => !app.modulesListState.visibleIds.has(id)),
    );
    draw();
    persist();
  }

  function setHighlight(nodeId: string | null) {
    if (!app.renderState) return;
    if (nodeId === null && isGraphPopupOpen()) return;
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
          app.graphNavigation = goBack(app.graphNavigation);
          void navigateGraph();
        },
        onForward: () => {
          app.graphNavigation = goForward(app.graphNavigation);
          void navigateGraph();
        },
        onNavigate: (crumb) => {
          app.graphNavigation = navigateTo(app.graphNavigation, crumb);
          void navigateGraph({ skipAutoAdvance: true });
        },
      },
      {
        stats: graph
          ? { nodes: graph.nodes.length, edges: graph.edges.length }
          : undefined,
        staleImports: hasStaleImportIndex(app.hierarchy),
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
    hideGraphPopup();
    if (!opts?.skipAutoAdvance) {
      const advanced = autoAdvanceSingleFolder(hierarchy, app.graphNavigation);
      if (advanced !== app.graphNavigation) {
        app.graphNavigation = advanced;
      }
    }
    const graph = graphForNavigation(hierarchy, app.graphNavigation);
    await loadGraph(graph, opts);
    refreshGraphNav(graph);
  }

  function drillIntoNode(nodeId: string) {
    if (!app.renderState || !app.hierarchy) return;
    const node = app.renderState.nodes.find((n) => n.id === nodeId);
    if (!node || !isDrillableNode(node, app.graphNavigation)) return;
    const next = drillTargetForNode(node, app.graphNavigation);
    if (!next) return;
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

  function openModulePopup(nodeId: string, clientX: number, clientY: number) {
    if (!app.renderState) return;
    const node = app.renderState.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    app.renderState.selectedId = nodeId;
    setHighlight(nodeId);
    toggleGraphPopup(
      node,
      app.renderState.nodes,
      app.renderState.edges,
      clientX,
      clientY,
      () => setHighlight(null),
    );
    persist();
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
      onShowDetails: (nodeId, clientX, clientY) => {
        showGraphView();
        openModulePopup(nodeId, clientX, clientY);
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
    hideGraphPopup();
    showOverlay("Computing layout…");
    const positionsList = await computeLayout(graph);
    const positions = new Map(positionsList.map((p) => [p.id, p]));

    app.renderState = createRenderState(graph.nodes, graph.edges, positions);

    const visible =
      opts?.visibleIds && opts.visibleIds.length > 0
        ? new Set(opts.visibleIds)
        : new Set(graph.nodes.map((n) => n.id));
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
    hideGraphPopup();
    fileViewer.close();
    showGraphView();
    clearHierarchyLoadCache();

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

      const displayPath = scan.root.split("/").pop() ?? scan.root;
      projectPathEl.textContent = displayPath;
      projectPathEl.title = scan.root;

      renderProjectTree(treeContainer, scan.tree, {
        onFileOpen: handleFileOpen,
      });
      refreshModulesList();
      btnRun.disabled = false;
      persist();
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
    hideGraphPopup();
    showGraphView();

    app.graphNavigation = rootNavigation();
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
    persist();
  }

  async function showDependencyOnGraph(source: string, target: string) {
    const hierarchy = await ensureAnalysisHierarchy();
    if (!hierarchy) return;
    hideAnalysisStatDetail();
    hideValidationDetail();
    hideGraphPopup();
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
    hideGraphPopup();
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
    hideGraphPopup();
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
    onNodeClick: (id, clientX, clientY) => {
      clearPendingPopup();
      if (!id) {
        hideGraphPopup();
        setHighlight(null);
        persist();
        return;
      }
      // Delay so a double-click can cancel and drill instead of flashing the popup.
      pendingPopupTimer = setTimeout(() => {
        pendingPopupTimer = null;
        openModulePopup(id, clientX, clientY);
      }, 220);
    },
    onNodeDoubleClick: (id) => {
      clearPendingPopup();
      hideGraphPopup();
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

  async function handleRunAnalysis() {
    if (!app.projectPath) return;
    if (rulesState.loading || rulesState.rules.length === 0) {
      await initRulesPanel();
    }
    if (app.selectedRules.size === 0) {
      alert("Select at least one analysis rule.");
      return;
    }

    const confirmed =
      analysisManager.hasRunning() ||
      (await showAnalysisDialog(app.selectedRules.size));
    if (!confirmed) return;

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
    });
  }

  btnOpen.addEventListener("click", handleOpenProject);
  btnRun.addEventListener("click", handleRunAnalysis);
  btnFocus.addEventListener("click", () => {
    if (app.renderState) {
      fitCameraToContent(app.renderState, canvas);
      draw();
      persist();
    }
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

  if (!persisted.projectPath) {
    showOverlay("Open a project to get started");
  } else {
    projectPathEl.textContent = "Restoring session…";
    runWhenIdleAsync(async () => {
      const ok = await openProjectAt(persisted.projectPath!);
      if (!ok) return;

      const meta = await loadPersistedAnalysisMeta();
      if (!meta) return;

      const emptyHierarchy: HierarchyIndex = {
        files: [],
        packages: [],
        file_imports: {},
        package_edges: [],
        symbols: {},
        symbol_edges: [],
      };

      app.analysisResult = { ...meta, hierarchy: emptyHierarchy };
      app.graphNavigation = persisted.graphNavigation ?? rootNavigation();
      resultsPanel.setResult(app.analysisResult);

      runWhenIdle(() => {
        void navigateGraph({
          visibleIds: persisted.visibleModuleIds,
          camera: persisted.camera,
          selectedId: persisted.selectedNodeId,
        });
      }, 3000);
    });
  }
}

