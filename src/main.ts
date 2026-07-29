import { computeLayout } from "./wasm-bridge";
import { render, createRenderState, type RenderState } from "./canvas/renderer";
import { attachInteraction } from "./canvas/interaction";
import { fitCameraToContent, focusCameraOnNodeAnimated } from "./canvas/camera";
import type { Graph } from "./graph/types";
import type { AnalysisResult } from "./analysis/types";
import { mergeRuleSettings, type RuleSettingsMap } from "./analysis/types";
import { mergeLspSettings, type LspSettingsMap } from "./lsp/types";
import { ensureLinterSettings, type LinterSettingsMap } from "./linter/types";
import type { ProjectScan } from "./project/types";
import {
  openProjectDialog,
  scanProject,
  getAnalysisRules,
  runAnalysis,
  readProjectFile,
  writeProjectFile,
  listLspServers,
  installLspServer,
  listLanguageLinters,
  installLinter,
} from "./project/api";
import { renderProjectTree } from "./ui/projectTree";
import { renderModulesList, type ModulesListState } from "./ui/modulesList";
import { createRulesPanel, type RulesPanelState } from "./ui/rulesPanel";
import {
  createLspServersPanel,
  type LspServersPanelState,
} from "./ui/lspServersPanel";
import {
  createLintersPanel,
  type LintersPanelState,
} from "./ui/lintersPanel";
import { createResultsPanel } from "./ui/resultsPanel";
import { createFileViewer } from "./ui/fileViewer";
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
import { renderFileNav } from "./ui/fileNav";
import { collectFileIssues } from "./validation/fileIssues";
import { hideValidationDetail } from "./ui/validationDetailPopup";
import type { HierarchyIndex } from "./analysis/types";
import { loadPersistedState, scheduleSaveState } from "./state/store";
import { applyPanelSizes, readPanelSizes } from "./state/panels";
import type { PersistedAppState } from "./state/types";

interface AppState {
  projectPath: string | null;
  projectScan: ProjectScan | null;
  selectedRules: Set<string>;
  ruleSettings: RuleSettingsMap;
  lspSettings: LspSettingsMap;
  linterSettings: LinterSettingsMap;
  analysisResult: AnalysisResult | null;
  hierarchy: HierarchyIndex | null;
  graphNavigation: GraphNavigation;
  renderState: RenderState | null;
  modulesListState: ModulesListState;
}

async function main() {
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
  const graphOverlay = document.querySelector<HTMLElement>("#graph-overlay")!;
  const graphOverlayText = document.querySelector<HTMLElement>("#graph-overlay-text")!;
  const fileViewerEl = document.querySelector<HTMLElement>("#file-viewer")!;
  const graphNavContainer = document.querySelector<HTMLElement>("#graph-nav")!;
  const viewTabs = document.querySelector<HTMLElement>("#view-tabs")!;

  const persisted = await loadPersistedState();
  applyPanelSizes(persisted.panelSizes);

  const rules = await getAnalysisRules();
  const selectedRuleIds =
    persisted.selectedRuleIds.length > 0
      ? persisted.selectedRuleIds
      : rules.map((r) => r.id);
  const selected = new Set(selectedRuleIds);
  if (
    persisted.selectedRuleIds.length > 0 &&
    !selected.has("language_linters") &&
    rules.some((r) => r.id === "language_linters")
  ) {
    selected.add("language_linters");
  }
  const rulesState: RulesPanelState = {
    rules,
    selected,
    settings: mergeRuleSettings(rules, persisted.ruleSettings),
    expandedRuleId: null,
  };

  const initialLinterSettings = ensureLinterSettings(persisted.linterSettings);

  const app: AppState = {
    projectPath: null,
    projectScan: null,
    selectedRules: rulesState.selected,
    ruleSettings: rulesState.settings,
    lspSettings: {},
    linterSettings: initialLinterSettings,
    analysisResult: null,
    hierarchy: null,
    graphNavigation: persisted.graphNavigation ?? rootNavigation(),
    renderState: null,
    modulesListState: {
      graphNodes: [],
      visibleIds: new Set(),
      searchQuery: "",
    },
  };

  const resultsPanel = createResultsPanel(resultsContainer, {
    getHierarchy: () => app.hierarchy,
    onOpenValidationTarget: (target) => {
      void openValidationTarget(target);
    },
    onShowValidationOnGraph: (target) => {
      void showValidationTargetOnGraph(target);
    },
  });

  const fileViewer = createFileViewer(
    fileViewerEl,
    () => {
      showGraphView();
    },
    {
      saveButton: btnSaveFile,
      onSave: async (path, content) => {
        if (!app.projectPath) return;
        await writeProjectFile(app.projectPath, path, content);
      },
    },
  );

  function refreshFileNav(path: string) {
    const issues = collectFileIssues(app.analysisResult, path);
    renderFileNav(graphNavContainer, {
      path,
      issues,
      onIssueClick: (line) => fileViewer.scrollToLine(line),
    });
  }

  function collectState(): PersistedAppState {
    return {
      version: 1,
      panelSizes: readPanelSizes(),
      projectPath: app.projectPath,
      selectedRuleIds: Array.from(app.selectedRules),
      ruleSettings: app.ruleSettings,
      lspSettings: app.lspSettings,
      linterSettings: app.linterSettings,
      visibleModuleIds: Array.from(app.modulesListState.visibleIds),
      selectedNodeId: app.renderState?.selectedId ?? null,
      camera: app.renderState
        ? { ...app.renderState.camera }
        : null,
      analysisResult: app.analysisResult,
      graphNavigation: serializeNavigation(app.graphNavigation),
    };
  }

  function persist(): void {
    scheduleSaveState(collectState());
  }

  function showGraphView() {
    fileViewerEl.classList.add("hidden");
    canvas.classList.remove("hidden");
    viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === "graph");
    });
    if (app.hierarchy) {
      const graph = graphForNavigation(app.hierarchy, app.graphNavigation);
      refreshGraphNav(graph);
    }
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

  createRulesPanel(rulesContainer, rulesState, (selected, settings) => {
    app.selectedRules = selected;
    app.ruleSettings = settings;
    rulesState.settings = settings;
    persist();
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

  const settings = createSettingsPanel(settingsOverlay, () => {
    // Paint the drawer first, then load tool metadata in the background.
    requestAnimationFrame(() => {
      if (!lspLoaded) void lspHandlers.onRefresh();
      if (!lintersLoaded) void lintersHandlers.onRefresh();
    });
  });
  btnSettings.addEventListener("click", () => settings.toggle());

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
    if (!app.hierarchy) return;
    hideGraphPopup();
    if (!opts?.skipAutoAdvance) {
      const advanced = autoAdvanceSingleFolder(app.hierarchy, app.graphNavigation);
      if (advanced !== app.graphNavigation) {
        app.graphNavigation = advanced;
      }
    }
    const graph = graphForNavigation(app.hierarchy, app.graphNavigation);
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
    await handleFileOpen(target.file, target.line);
  }

  async function showValidationTargetOnGraph(target: ValidationNavTarget) {
    if (!app.hierarchy) return;
    hideValidationDetail();
    hideGraphPopup();
    showGraphView();

    const wantsSymbol =
      Boolean(target.symbolId) || (target.line != null && target.line > 0);

    if (wantsSymbol) {
      app.graphNavigation = navigationToFile(app.hierarchy, target.file);
      let symbolId = target.symbolId;
      if (!symbolId && target.line != null) {
        symbolId = findSymbolAtLine(
          app.hierarchy,
          target.file,
          target.line,
        )?.id;
      }
      const graph = graphForNavigation(app.hierarchy, app.graphNavigation);
      await loadGraph(graph, { selectedId: symbolId ?? undefined });
      if (symbolId && app.renderState) {
        focusCameraOnNodeAnimated(app.renderState, canvas, symbolId, draw);
        setHighlight(symbolId);
      }
    } else {
      app.graphNavigation = navigationToPackageFile(app.hierarchy, target.file);
      const graph = graphForNavigation(app.hierarchy, app.graphNavigation);
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

  attachInteraction(canvas, () => app.renderState, {
    onChange: () => {
      draw();
      if (app.renderState) persist();
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
    if (app.selectedRules.size === 0) {
      alert("Select at least one analysis rule.");
      return;
    }

    const confirmed = await showAnalysisDialog(app.selectedRules.size);
    if (!confirmed) return;

    try {
      btnRun.disabled = true;
      resultsPanel.setRunning(true);
      showGraphView();

      const linterSettings = ensureLinterSettings(
        app.linterSettings,
        lintersState.groups.length > 0 ? lintersState.groups : undefined,
      );
      app.linterSettings = linterSettings;
      lintersState.settings = linterSettings;

      const result = await runAnalysis(
        app.projectPath,
        Array.from(app.selectedRules),
        (progress) => resultsPanel.setProgress(progress),
        app.ruleSettings,
        app.lspSettings,
        linterSettings,
      );

      app.analysisResult = result;
      app.hierarchy = result.hierarchy;
      app.graphNavigation = rootNavigation();
      resultsPanel.setResult(result);
      await navigateGraph();
    } catch (err) {
      resultsPanel.setResult(null);
      console.error(err);
      alert(`Analysis failed: ${err}`);
    } finally {
      btnRun.disabled = false;
    }
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

  // Restore previous session
  if (persisted.projectPath) {
    const ok = await openProjectAt(persisted.projectPath);
    if (ok && persisted.analysisResult) {
      app.analysisResult = persisted.analysisResult;
      app.hierarchy = persisted.analysisResult.hierarchy;
      if (!app.hierarchy) {
        const { hierarchyFromGraph } = await import("./graph/hierarchy");
        app.hierarchy = hierarchyFromGraph(persisted.analysisResult.graph);
      }
      app.graphNavigation = persisted.graphNavigation ?? rootNavigation();
      resultsPanel.setResult(persisted.analysisResult);
      await navigateGraph({
        visibleIds: persisted.visibleModuleIds,
        camera: persisted.camera,
        selectedId: persisted.selectedNodeId,
      });
    }
  } else {
    showOverlay("Open a project to get started");
  }
}

main().catch(console.error);
