import type { AnalysisResult } from "../analysis/types";
import type { GraphNavigation } from "../graph/navigation";

export interface PanelSizes {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  leftTreeHeight: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface PersistedAppState {
  version: 1;
  panelSizes: PanelSizes;
  projectPath: string | null;
  selectedRuleIds: string[];
  visibleModuleIds: string[];
  selectedNodeId: string | null;
  camera: CameraState | null;
  analysisResult: AnalysisResult | null;
  graphNavigation: GraphNavigation | null;
}

export const DEFAULT_PANEL_SIZES: PanelSizes = {
  leftWidth: 240,
  rightWidth: 260,
  bottomHeight: 200,
  leftTreeHeight: 50,
};

export function defaultPersistedState(): PersistedAppState {
  return {
    version: 1,
    panelSizes: { ...DEFAULT_PANEL_SIZES },
    projectPath: null,
    selectedRuleIds: [],
    visibleModuleIds: [],
    selectedNodeId: null,
    camera: null,
    analysisResult: null,
    graphNavigation: null,
  };
}
