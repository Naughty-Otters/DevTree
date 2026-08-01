import type {
  AnalysisResult,
  HierarchyIndex,
  QualityIndex,
  SuggestionItem,
  ValidationItem,
} from "../analysis/types";
import type { DsmResult } from "../analysis/dsm";
import type { Graph } from "../graph/types";
import {
  defaultPersistedState,
  type PersistedAppState,
  type PersistedUiState,
} from "./types";

const UI_STATE_KEY = "app";
const ANALYSIS_META_KEY = "analysis-meta";
const ANALYSIS_HIERARCHY_KEY = "analysis-hierarchy";
const ANALYSIS_QUALITY_KEY = "analysis-quality";
/** @deprecated Migrated to split keys */
const ANALYSIS_STATE_KEY = "analysis";
const LEGACY_PANEL_KEY = "devtree-panel-sizes";
const LEGACY_OPTIONS_KEY = "devtree-analysis-options";

function emptyHierarchy(): HierarchyIndex {
  return {
    files: [],
    packages: [],
    file_imports: {},
    package_edges: [],
    symbols: {},
    symbol_edges: [],
  };
}

function qualityIsHydrated(quality: QualityIndex | null | undefined): boolean {
  if (!quality) return false;
  return (
    Object.keys(quality.files).length > 0 ||
    Object.keys(quality.packages).length > 0
  );
}

export interface PersistedAnalysisMeta {
  graph: Graph;
  validation: ValidationItem[];
  suggestions: SuggestionItem[];
  summary: string;
  dsm?: DsmResult | null;
}

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function loadRaw(key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string | null>("load_persisted_state", { key });
    } catch (err) {
      console.warn(`Failed to load state key "${key}" from SQLite:`, err);
      return null;
    }
  }

  try {
    return localStorage.getItem(`devtree-${key}`);
  } catch {
    return null;
  }
}

async function saveRaw(key: string, json: string): Promise<void> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_persisted_state", { key, value: json });
      return;
    } catch (err) {
      console.warn(`Failed to save state key "${key}" to SQLite:`, err);
    }
  }

  localStorage.setItem(`devtree-${key}`, json);
}

function migrateLegacy(): Partial<PersistedUiState> | null {
  const partial: Partial<PersistedUiState> = {};
  let found = false;

  try {
    const panels = localStorage.getItem(LEGACY_PANEL_KEY);
    if (panels) {
      const sizes = JSON.parse(panels) as Record<string, number>;
      partial.panelSizes = {
        leftWidth: sizes["--left-width"] ?? 240,
        rightWidth: sizes["--right-width"] ?? 360,
        bottomHeight: sizes["--bottom-height"] ?? 200,
        leftTreeHeight: sizes["--left-tree-height"] ?? 50,
      };
      found = true;
    }
  } catch {
    // ignore
  }

  try {
    const opts = localStorage.getItem(LEGACY_OPTIONS_KEY);
    if (opts) {
      found = true;
    }
  } catch {
    // ignore
  }

  return found ? partial : null;
}

function parseUiState(raw: string | null): PersistedUiState {
  const base = defaultPersistedState();
  if (!raw) return base;

  const parsed = JSON.parse(raw) as Partial<PersistedAppState>;
  const { analysisResult: _ignored, ...ui } = parsed;
  return {
    ...base,
    ...ui,
    version: 1,
  };
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function migrateLegacyAnalysisBlob(): Promise<AnalysisResult | null> {
  const fromCombined = parseJson<AnalysisResult>(await loadRaw(ANALYSIS_STATE_KEY));
  if (fromCombined) {
    await saveSplitAnalysis(fromCombined);
    return fromCombined;
  }

  const uiRaw = await loadRaw(UI_STATE_KEY);
  if (!uiRaw) return null;

  try {
    const legacy = JSON.parse(uiRaw) as PersistedAppState;
    if (!legacy.analysisResult) return null;
    await saveSplitAnalysis(legacy.analysisResult);
    const ui = parseUiState(uiRaw);
    void saveRaw(UI_STATE_KEY, JSON.stringify(ui));
    return legacy.analysisResult;
  } catch {
    return null;
  }
}

async function saveSplitAnalysis(result: AnalysisResult | null): Promise<void> {
  if (!result) {
    await Promise.all([
      saveRaw(ANALYSIS_META_KEY, "null"),
      saveRaw(ANALYSIS_HIERARCHY_KEY, "null"),
      saveRaw(ANALYSIS_QUALITY_KEY, "null"),
    ]);
    return;
  }

  const meta: PersistedAnalysisMeta = {
    graph: result.graph,
    validation: result.validation,
    suggestions: result.suggestions,
    summary: result.summary,
    dsm: result.dsm ?? null,
  };
  const quality = qualityIsHydrated(result.quality) ? result.quality : null;
  await Promise.all([
    saveRaw(ANALYSIS_META_KEY, JSON.stringify(meta)),
    saveRaw(ANALYSIS_HIERARCHY_KEY, JSON.stringify(result.hierarchy)),
    saveRaw(
      ANALYSIS_QUALITY_KEY,
      quality ? JSON.stringify(quality) : "null",
    ),
  ]);
}

export async function loadPersistedUiState(): Promise<PersistedUiState> {
  const base = defaultPersistedState();
  const uiRaw = await loadRaw(UI_STATE_KEY);
  let ui = parseUiState(uiRaw);

  if (!uiRaw) {
    const legacy = migrateLegacy();
    if (legacy) ui = { ...base, ...legacy };
  }

  return ui;
}

export async function loadPersistedAnalysisMeta(): Promise<PersistedAnalysisMeta | null> {
  const meta = parseJson<PersistedAnalysisMeta>(await loadRaw(ANALYSIS_META_KEY));
  if (meta) return meta;

  const legacy = await migrateLegacyAnalysisBlob();
  if (!legacy) return null;

  return {
    graph: legacy.graph,
    validation: legacy.validation,
    suggestions: legacy.suggestions,
    summary: legacy.summary,
    dsm: legacy.dsm ?? null,
  };
}

export async function loadPersistedAnalysisHierarchy(): Promise<HierarchyIndex | null> {
  const hierarchy = parseJson<HierarchyIndex>(
    await loadRaw(ANALYSIS_HIERARCHY_KEY),
  );
  if (hierarchy) return hierarchy;

  const legacy = await migrateLegacyAnalysisBlob();
  return legacy?.hierarchy ?? null;
}

export async function loadPersistedAnalysisQuality(): Promise<QualityIndex | null> {
  const quality = parseJson<QualityIndex>(await loadRaw(ANALYSIS_QUALITY_KEY));
  if (qualityIsHydrated(quality)) return quality;

  const legacy = await migrateLegacyAnalysisBlob();
  return qualityIsHydrated(legacy?.quality) ? legacy!.quality! : null;
}

export async function loadPersistedAnalysis(): Promise<AnalysisResult | null> {
  const [meta, hierarchy, quality] = await Promise.all([
    loadPersistedAnalysisMeta(),
    loadPersistedAnalysisHierarchy(),
    loadPersistedAnalysisQuality(),
  ]);
  if (!meta) return null;

  return {
    ...meta,
    hierarchy: hierarchy ?? emptyHierarchy(),
    quality: quality ?? null,
  };
}

export async function loadPersistedState(): Promise<PersistedAppState> {
  const [ui, analysisResult] = await Promise.all([
    loadPersistedUiState(),
    loadPersistedAnalysis(),
  ]);
  return { ...ui, analysisResult };
}

let uiSaveTimer: ReturnType<typeof setTimeout> | null = null;
let analysisSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Fast save for UI prefs — never includes analysis payload. */
export function scheduleSaveUiState(state: PersistedUiState): void {
  if (uiSaveTimer) clearTimeout(uiSaveTimer);
  uiSaveTimer = setTimeout(() => {
    uiSaveTimer = null;
    void saveRaw(UI_STATE_KEY, JSON.stringify(state));
  }, 400);
}

/** Heavy save — meta and hierarchy stored separately for lazy hydration. */
export function scheduleSaveAnalysis(result: AnalysisResult | null): void {
  if (analysisSaveTimer) clearTimeout(analysisSaveTimer);
  analysisSaveTimer = setTimeout(() => {
    analysisSaveTimer = null;
    const run = () => {
      void saveSplitAnalysis(result);
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 8000 });
    } else {
      run();
    }
  }, 2000);
}

/** @deprecated Use scheduleSaveUiState / scheduleSaveAnalysis instead. */
export function scheduleSaveState(state: PersistedAppState): void {
  const { analysisResult, ...ui } = state;
  scheduleSaveUiState(ui);
  scheduleSaveAnalysis(analysisResult);
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  const { analysisResult, ...ui } = state;
  await saveRaw(UI_STATE_KEY, JSON.stringify(ui));
  await saveSplitAnalysis(analysisResult);
}
