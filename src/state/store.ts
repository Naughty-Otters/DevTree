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
  appendScorePoint,
  computeScoreSnapshot,
  parseScoreHistory,
  type AnalysisScoreHistory,
  type AnalysisScoreSnapshot,
} from "../analysis/scoreHistory";
import type { PercentileViewMode } from "../analysis/percentileView";
import {
  defaultPersistedState,
  type PersistedAppState,
  type PersistedUiState,
} from "./types";

const UI_STATE_KEY = "app";
/** Active project root for which analysis keys are written (legacy pointer). */
const ANALYSIS_PROJECT_KEY = "analysis-project";
/** @deprecated Unscoped keys — migrated into per-project keys. */
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

function hierarchyIsHydrated(hierarchy: HierarchyIndex | null | undefined): boolean {
  return Boolean(
    hierarchy && (hierarchy.files.length > 0 || hierarchy.packages.length > 0),
  );
}

/** Normalize project roots so the same folder maps to one storage key. */
export function normalizeProjectRoot(root: string): string {
  const trimmed = root.trim().replace(/\\/g, "/");
  if (trimmed.length <= 1) return trimmed;
  return trimmed.replace(/\/+$/, "");
}

function analysisKeys(projectRoot: string): {
  meta: string;
  hierarchy: string;
  quality: string;
  scoreHistory: string;
} {
  const id = normalizeProjectRoot(projectRoot);
  return {
    meta: `analysis-meta::${id}`,
    hierarchy: `analysis-hierarchy::${id}`,
    quality: `analysis-quality::${id}`,
    scoreHistory: `analysis-score-history::${id}`,
  };
}

export interface PersistedAnalysisMeta {
  graph: Graph;
  validation: ValidationItem[];
  suggestions: SuggestionItem[];
  summary: string;
  dsm?: DsmResult | null;
  /** Project this analysis belongs to — required to avoid cross-project restore. */
  projectRoot?: string;
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

function metaMatchesProject(
  meta: PersistedAnalysisMeta,
  projectRoot: string,
): boolean {
  if (!meta.projectRoot) return true; // legacy blob — caller decides migration
  return normalizeProjectRoot(meta.projectRoot) === normalizeProjectRoot(projectRoot);
}

async function clearUnscopedAnalysisKeys(): Promise<void> {
  await Promise.all([
    saveRaw(ANALYSIS_META_KEY, "null"),
    saveRaw(ANALYSIS_HIERARCHY_KEY, "null"),
    saveRaw(ANALYSIS_QUALITY_KEY, "null"),
    saveRaw(ANALYSIS_STATE_KEY, "null"),
  ]);
}

async function saveSplitAnalysisForProject(
  result: AnalysisResult | null,
  projectRoot: string,
): Promise<void> {
  const keys = analysisKeys(projectRoot);
  await saveRaw(ANALYSIS_PROJECT_KEY, JSON.stringify(normalizeProjectRoot(projectRoot)));

  if (!result) {
    await Promise.all([
      saveRaw(keys.meta, "null"),
      saveRaw(keys.hierarchy, "null"),
      saveRaw(keys.quality, "null"),
    ]);
    return;
  }

  const meta: PersistedAnalysisMeta = {
    graph: result.graph,
    validation: result.validation,
    suggestions: result.suggestions,
    summary: result.summary,
    dsm: result.dsm ?? null,
    projectRoot: normalizeProjectRoot(projectRoot),
  };
  // SQLite stays slim: meta + hierarchy-lite (no symbols) + package quality only.
  // Never persist quality.files or symbol_edges here (those live in ~/.devtree/cache/).
  const writes: Promise<void>[] = [saveRaw(keys.meta, JSON.stringify(meta))];

  if (hierarchyIsHydrated(result.hierarchy)) {
    const edgeCount = result.hierarchy.symbol_edges?.length ?? 0;
    if (edgeCount <= 50_000) {
      writes.push(
        saveRaw(
          keys.hierarchy,
          JSON.stringify({
            ...result.hierarchy,
            symbols: {},
            symbol_edges: [],
            scope_graphs: {},
          }),
        ),
      );
    }
    // Oversized legacy blobs are skipped — keep any existing pointer/cache.
  }

  if (result.quality && Object.keys(result.quality.packages).length > 0) {
    writes.push(
      saveRaw(
        keys.quality,
        JSON.stringify({
          files: {},
          packages: result.quality.packages,
        }),
      ),
    );
  } else {
    writes.push(saveRaw(keys.quality, "null"));
  }
  await Promise.all(writes);
}

let legacyMigrateInFlight: Promise<AnalysisResult | null> | null = null;
let legacyMigrateRoot: string | null = null;

/**
 * One-time move of legacy unscoped analysis into per-project keys.
 * Never attaches another project's tagged analysis to this root.
 */
async function migrateLegacyAnalysisToProject(
  projectRoot: string,
): Promise<AnalysisResult | null> {
  const norm = normalizeProjectRoot(projectRoot);
  if (legacyMigrateInFlight && legacyMigrateRoot === norm) {
    return legacyMigrateInFlight;
  }

  legacyMigrateRoot = norm;
  legacyMigrateInFlight = (async () => {
    // Already migrated?
    const existing = parseJson<PersistedAnalysisMeta>(
      await loadRaw(analysisKeys(norm).meta),
    );
    if (existing && metaMatchesProject(existing, norm)) {
      const hierarchy =
        parseJson<HierarchyIndex>(await loadRaw(analysisKeys(norm).hierarchy)) ??
        emptyHierarchy();
      const quality = parseJson<QualityIndex>(
        await loadRaw(analysisKeys(norm).quality),
      );
      return {
        ...existing,
        hierarchy,
        quality: qualityIsHydrated(quality) ? quality : null,
      };
    }

    const fromCombined = parseJson<AnalysisResult>(
      await loadRaw(ANALYSIS_STATE_KEY),
    );
    if (fromCombined) {
      await saveSplitAnalysisForProject(fromCombined, norm);
      await clearUnscopedAnalysisKeys();
      return fromCombined;
    }

    const legacyMeta = parseJson<PersistedAnalysisMeta>(
      await loadRaw(ANALYSIS_META_KEY),
    );
    if (!legacyMeta?.graph) {
      const uiRaw = await loadRaw(UI_STATE_KEY);
      if (uiRaw) {
        try {
          const legacy = JSON.parse(uiRaw) as PersistedAppState;
          if (legacy.analysisResult) {
            await saveSplitAnalysisForProject(legacy.analysisResult, norm);
            const ui = parseUiState(uiRaw);
            void saveRaw(UI_STATE_KEY, JSON.stringify(ui));
            await clearUnscopedAnalysisKeys();
            return legacy.analysisResult;
          }
        } catch {
          // ignore
        }
      }
      return null;
    }

    if (legacyMeta.projectRoot && !metaMatchesProject(legacyMeta, norm)) {
      return null;
    }

    const hierarchy =
      parseJson<HierarchyIndex>(await loadRaw(ANALYSIS_HIERARCHY_KEY)) ??
      emptyHierarchy();
    const quality = parseJson<QualityIndex>(await loadRaw(ANALYSIS_QUALITY_KEY));
    const result: AnalysisResult = {
      graph: legacyMeta.graph,
      validation: legacyMeta.validation,
      suggestions: legacyMeta.suggestions,
      summary: legacyMeta.summary,
      dsm: legacyMeta.dsm ?? null,
      hierarchy,
      quality: qualityIsHydrated(quality) ? quality : null,
    };
    await saveSplitAnalysisForProject(result, norm);
    await clearUnscopedAnalysisKeys();
    return result;
  })().finally(() => {
    if (legacyMigrateRoot === norm) {
      legacyMigrateInFlight = null;
      legacyMigrateRoot = null;
    }
  });

  return legacyMigrateInFlight;
}

async function saveSplitAnalysis(
  result: AnalysisResult | null,
  projectRoot?: string | null,
): Promise<void> {
  const root =
    projectRoot ??
    parseJson<string>(await loadRaw(ANALYSIS_PROJECT_KEY)) ??
    null;

  if (!root) {
    // No project context — clear legacy unscoped keys only.
    if (!result) await clearUnscopedAnalysisKeys();
    return;
  }

  await saveSplitAnalysisForProject(result, root);
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

async function resolveProjectRoot(
  projectRoot?: string | null,
): Promise<string | null> {
  if (projectRoot && projectRoot.trim()) {
    return normalizeProjectRoot(projectRoot);
  }
  return parseJson<string>(await loadRaw(ANALYSIS_PROJECT_KEY));
}

export async function loadPersistedAnalysisMeta(
  projectRoot?: string | null,
): Promise<PersistedAnalysisMeta | null> {
  const root = await resolveProjectRoot(projectRoot);
  if (!root) return null;

  const keys = analysisKeys(root);
  let meta = parseJson<PersistedAnalysisMeta>(await loadRaw(keys.meta));
  if (!meta) {
    const migrated = await migrateLegacyAnalysisToProject(root);
    if (!migrated) return null;
    return {
      graph: migrated.graph,
      validation: migrated.validation,
      suggestions: migrated.suggestions,
      summary: migrated.summary,
      dsm: migrated.dsm ?? null,
      projectRoot: root,
    };
  }
  if (!metaMatchesProject(meta, root)) return null;
  return meta;
}

interface HierarchyCachePointer {
  v: number;
  path: string;
}

function isHierarchyPointer(value: unknown): value is HierarchyCachePointer {
  return (
    !!value &&
    typeof value === "object" &&
    "path" in value &&
    typeof (value as HierarchyCachePointer).path === "string"
  );
}

export async function loadPersistedAnalysisHierarchy(
  projectRoot?: string | null,
): Promise<HierarchyIndex | null> {
  const root = await resolveProjectRoot(projectRoot);
  if (!root) return null;

  const keys = analysisKeys(root);
  const raw = await loadRaw(keys.hierarchy);
  const parsed = parseJson<HierarchyIndex | HierarchyCachePointer>(raw);

  // v2 pointer → file cache (preferred). Actual file read goes through Tauri.
  if (isHierarchyPointer(parsed)) {
    try {
      const { loadAnalysisHierarchyLite } = await import("../project/api");
      return await loadAnalysisHierarchyLite(root);
    } catch {
      return null;
    }
  }

  // Legacy full blob in SQLite — only accept if already lite-sized.
  if (hierarchyIsHydrated(parsed as HierarchyIndex | null)) {
    const h = parsed as HierarchyIndex;
    // Refuse to hydrate multi-hundred-MB legacy blobs with symbols.
    if (h.symbol_edges && h.symbol_edges.length > 50_000) {
      console.warn(
        "Ignoring oversized legacy hierarchy in SQLite; re-run analysis.",
      );
      return null;
    }
    return h;
  }

  const migrated = await migrateLegacyAnalysisToProject(root);
  const migratedH = migrated?.hierarchy ?? null;
  if (
    migratedH?.symbol_edges &&
    migratedH.symbol_edges.length > 50_000
  ) {
    return null;
  }
  return migratedH;
}

export async function loadPersistedAnalysisQuality(
  projectRoot?: string | null,
): Promise<QualityIndex | null> {
  const root = await resolveProjectRoot(projectRoot);
  if (!root) return null;

  const keys = analysisKeys(root);
  const quality = parseJson<QualityIndex>(await loadRaw(keys.quality));
  if (qualityIsHydrated(quality)) return quality;

  const migrated = await migrateLegacyAnalysisToProject(root);
  return qualityIsHydrated(migrated?.quality) ? migrated!.quality! : null;
}

export async function loadScoreHistory(
  projectRoot?: string | null,
): Promise<AnalysisScoreSnapshot[]> {
  const root = await resolveProjectRoot(projectRoot);
  if (!root) return [];

  const keys = analysisKeys(root);
  const raw = parseJson<unknown>(await loadRaw(keys.scoreHistory));
  const history = parseScoreHistory(raw, root);
  return history?.points ?? [];
}

/**
 * Compute and append a score snapshot for a completed analysis run.
 * No-ops when quality metrics are missing.
 */
export async function appendScoreHistorySnapshot(
  result: AnalysisResult,
  projectRoot: string | null | undefined,
  percentileView: PercentileViewMode | string = "all",
): Promise<AnalysisScoreSnapshot[]> {
  if (!projectRoot?.trim()) return [];
  const root = normalizeProjectRoot(projectRoot);
  const snap = computeScoreSnapshot(result, percentileView);
  if (!snap) return loadScoreHistory(root);

  const keys = analysisKeys(root);
  const existing = await loadScoreHistory(root);
  const points = appendScorePoint(existing, snap);
  const payload: AnalysisScoreHistory = {
    version: 2,
    projectRoot: root,
    points,
  };
  await saveRaw(keys.scoreHistory, JSON.stringify(payload));
  return points;
}

export async function loadPersistedAnalysis(
  projectRoot?: string | null,
): Promise<AnalysisResult | null> {
  const root = await resolveProjectRoot(projectRoot);
  if (!root) return null;

  const [meta, hierarchy, quality] = await Promise.all([
    loadPersistedAnalysisMeta(root),
    loadPersistedAnalysisHierarchy(root),
    loadPersistedAnalysisQuality(root),
  ]);
  if (!meta) return null;

  return {
    ...meta,
    hierarchy: hierarchy ?? emptyHierarchy(),
    quality: quality ?? null,
  };
}

export async function loadPersistedState(): Promise<PersistedAppState> {
  const ui = await loadPersistedUiState();
  const analysisResult = ui.projectPath
    ? await loadPersistedAnalysis(ui.projectPath)
    : null;
  return { ...ui, analysisResult };
}

let uiSaveTimer: ReturnType<typeof setTimeout> | null = null;
let analysisSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAnalysisProject: string | null = null;

/** Fast save for UI prefs — never includes analysis payload. */
export function scheduleSaveUiState(state: PersistedUiState): void {
  if (uiSaveTimer) clearTimeout(uiSaveTimer);
  uiSaveTimer = setTimeout(() => {
    uiSaveTimer = null;
    void saveRaw(UI_STATE_KEY, JSON.stringify(state));
  }, 400);
}

/** Immediate UI prefs write (e.g. before language reload). */
export async function saveUiStateNow(state: PersistedUiState): Promise<void> {
  if (uiSaveTimer) {
    clearTimeout(uiSaveTimer);
    uiSaveTimer = null;
  }
  await saveRaw(UI_STATE_KEY, JSON.stringify(state));
}

/** Heavy save — meta and hierarchy stored per project root. */
export function scheduleSaveAnalysis(
  result: AnalysisResult | null,
  projectRoot?: string | null,
): void {
  pendingAnalysisProject = projectRoot ?? pendingAnalysisProject;
  if (analysisSaveTimer) clearTimeout(analysisSaveTimer);
  analysisSaveTimer = setTimeout(() => {
    analysisSaveTimer = null;
    const root = pendingAnalysisProject;
    const run = () => {
      void saveSplitAnalysis(result, root);
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
  scheduleSaveAnalysis(analysisResult, ui.projectPath);
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  const { analysisResult, ...ui } = state;
  await saveRaw(UI_STATE_KEY, JSON.stringify(ui));
  await saveSplitAnalysis(analysisResult, ui.projectPath);
}
