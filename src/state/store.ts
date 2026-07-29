import {
  defaultPersistedState,
  type PersistedAppState,
} from "./types";

const STATE_KEY = "app";
const LEGACY_PANEL_KEY = "devtree-panel-sizes";
const LEGACY_OPTIONS_KEY = "devtree-analysis-options";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function migrateLegacy(): Partial<PersistedAppState> | null {
  const partial: Partial<PersistedAppState> = {};
  let found = false;

  try {
    const panels = localStorage.getItem(LEGACY_PANEL_KEY);
    if (panels) {
      const sizes = JSON.parse(panels) as Record<string, number>;
      partial.panelSizes = {
        leftWidth: sizes["--left-width"] ?? 240,
        rightWidth: sizes["--right-width"] ?? 260,
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

export async function loadPersistedState(): Promise<PersistedAppState> {
  const base = defaultPersistedState();

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string | null>("load_persisted_state", {
        key: STATE_KEY,
      });
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedAppState;
        return { ...base, ...parsed, version: 1 };
      }
    } catch (err) {
      console.warn("Failed to load state from SQLite:", err);
    }
  } else {
    try {
      const raw = localStorage.getItem(`devtree-${STATE_KEY}`);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedAppState;
        return { ...base, ...parsed, version: 1 };
      }
    } catch {
      // ignore
    }
  }

  const legacy = migrateLegacy();
  if (legacy) return { ...base, ...legacy };

  return base;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSaveState(state: PersistedAppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void savePersistedState(state);
  }, 400);
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  const json = JSON.stringify(state);

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_persisted_state", { key: STATE_KEY, value: json });
      return;
    } catch (err) {
      console.warn("Failed to save state to SQLite:", err);
    }
  }

  localStorage.setItem(`devtree-${STATE_KEY}`, json);
}
