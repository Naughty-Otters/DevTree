import type { AnalysisResult, RuleSettingsMap } from "../analysis/types";
import type { LspSettingsMap } from "../lsp/types";
import type { LinterSettingsMap } from "../linter/types";
import type { LlmConfiguration, AiValidationRuntimeSettings } from "../validation/aiValidation";
import {
  defaultAiValidationRuntimeSettings,
  defaultLlmConfigurations,
} from "../validation/aiValidation";
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

export interface PersistedUiState {
  version: 1;
  panelSizes: PanelSizes;
  projectPath: string | null;
  selectedRuleIds: string[];
  ruleSettings: RuleSettingsMap;
  lspSettings: LspSettingsMap;
  linterSettings: LinterSettingsMap;
  llmConfigurations: LlmConfiguration[];
  aiValidationRuntime: AiValidationRuntimeSettings;
  visibleModuleIds: string[];
  selectedNodeId: string | null;
  camera: CameraState | null;
  graphNavigation: GraphNavigation | null;
}

export interface PersistedAppState extends PersistedUiState {
  analysisResult: AnalysisResult | null;
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
    ruleSettings: {},
    lspSettings: {},
    linterSettings: {},
    llmConfigurations: defaultLlmConfigurations(),
    aiValidationRuntime: defaultAiValidationRuntimeSettings(),
    visibleModuleIds: [],
    selectedNodeId: null,
    camera: null,
    graphNavigation: null,
    analysisResult: null,
  };
}
