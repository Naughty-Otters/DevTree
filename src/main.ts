import { computeLayout } from "./wasm-bridge";
import { render, createRenderState, type RenderState } from "./canvas/renderer";
import { attachInteraction } from "./canvas/interaction";
import { fitCameraToContent, focusCameraOnNodeAnimated } from "./canvas/camera";
import type { Graph } from "./graph/types";
import type { AnalysisResult } from "./analysis/types";
import type { ProjectScan } from "./project/types";
import {
  openProjectDialog,
  scanProject,
  getAnalysisRules,
  runAnalysis,
  readProjectFile,
} from "./project/api";
import { renderProjectTree } from "./ui/projectTree";
import { renderModulesList, type ModulesListState } from "./ui/modulesList";
import { createRulesPanel, type RulesPanelState } from "./ui/rulesPanel";
import { createResultsPanel } from "./ui/resultsPanel";
import { createFileViewer } from "./ui/fileViewer";
import { mountToolbarIcons } from "./ui/toolbar";
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
import type { HierarchyIndex } from "./analysis/types";
import { loadPersistedState, scheduleSaveState } from "./state/store";
import { applyPanelSizes, readPanelSizes } from "./state/panels";
import type { PersistedAppState } from "./state/types";

interface AppState {
  projectPath: string | null;
  projectScan: ProjectScan | null;
  selectedRules: Set<string>;
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
  const projectPathEl = document.querySelector<HTMLElement>("#project-path")!;
  const treeContainer = document.querySelector<HTMLElement>("#project-tree")!;
  const modulesContainer = document.querySelector<HTMLElement>("#modules-list")!;
  const rulesContainer = document.querySelector<HTMLElement>("#rules-panel")!;
  const resultsContainer = document.querySelector<HTMLElement>("#results-panel")!;
  const graphOverlay = document.querySelector<HTMLElement>("#graph-overlay")!;
  const graphOverlayText = document.querySelector<HTMLElement>("#graph-overlay-text")!;
  const fileViewerEl = document.querySelector<HTMLElement>("#file-viewer")!;
  const graphNavContainer = document.querySelector<HTMLElement>("#graph-nav")!;
  const viewTabs = document.querySelector<HTMLElement>("#view-tabs")!;

  const persisted = await loadPersistedState();
  applyPanelSizes(persisted.panelSizes);

  const rules = await getAnalysisRules();
  const rulesState: RulesPanelState = {
    rules,
    selected: new Set(
      persisted.selectedRuleIds.length > 0
        ? persisted.selectedRuleIds
        : rules.map((r) => r.id),
    ),
  };

  const app: AppState = {
    projectPath: null,
    projectScan: null,
    selectedRules: rulesState.selected,
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

  const resultsPanel = createResultsPanel(resultsContainer);

  const fileViewer = createFileViewer(fileViewerEl, () => {
    showGraphView();
  });

  function collectState(): PersistedAppState {
    return {
      version: 1,
      panelSizes: readPanelSizes(),
      projectPath: app.projectPath,
      selectedRuleIds: Array.from(app.selectedRules),
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
  }

  function showFileView() {
    fileViewerEl.classList.remove("hidden");
    canvas.classList.add("hidden");
    viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === "file");
    });
  }

  viewTabs.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.view === "graph") showGraphView();
      else if (fileViewer.isOpen()) showFileView();
    });
  });

  createRulesPanel(rulesContainer, rulesState, (selected) => {
    app.selectedRules = selected;
    persist();
  });

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

  async function openProjectAt(path: string): Promise<boolean> {
    try {
      projectPathEl.textContent = "Scanning…";
      const scan = await scanProject(path);
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
      hideOverlay();
      persist();
      return true;
    } catch (err) {
      console.error(err);
      projectPathEl.textContent = "Failed to open project";
      return false;
    }
  }

  async function handleFileOpen(relativePath: string) {
    if (!app.projectPath) return;
    try {
      const content = await readProjectFile(app.projectPath, relativePath);
      fileViewer.open(relativePath, content);
      showFileView();
    } catch (err) {
      console.error(err);
      alert(`Could not open file: ${err}`);
    }
  }

  window.addEventListener("resize", resize);

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
    onNodeClick: (id, clientX, clientY, shiftKey) => {
      if (!id) {
        hideGraphPopup();
        setHighlight(null);
        persist();
        return;
      }
      const node = app.renderState?.nodes.find((n) => n.id === id);
      if (!node) return;
      if (!shiftKey && isDrillableNode(node, app.graphNavigation)) {
        drillIntoNode(id);
        return;
      }
      openModulePopup(id, clientX, clientY);
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

      const result = await runAnalysis(
        app.projectPath,
        Array.from(app.selectedRules),
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
