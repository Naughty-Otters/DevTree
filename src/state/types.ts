import type { AnalysisResult, RuleSettingsMap } from "../analysis/types";
import type { DesignRule } from "../analysis/designRules";
import { defaultDesignRules } from "../analysis/designRules";
import type { LspSettingsMap } from "../lsp/types";
import type { LinterSettingsMap } from "../linter/types";
import type { LlmConfiguration, AiValidationRuntimeSettings } from "../validation/aiValidation";
import {
  defaultAiValidationRuntimeSettings,
  defaultLlmConfigurations,
} from "../validation/aiValidation";
import type { GraphNavigation } from "../graph/navigation";
import type { AnalysisTriggerConfig } from "../analysis/triggers";
import { defaultAnalysisTriggerConfig } from "../analysis/triggers";

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
  settingsPanelOpen: boolean;
  projectPath: string | null;
  selectedRuleIds: string[];
  ruleSettings: RuleSettingsMap;
  lspSettings: LspSettingsMap;
  linterSettings: LinterSettingsMap;
  llmConfigurations: LlmConfiguration[];
  aiValidationRuntime: AiValidationRuntimeSettings;
  analysisTriggers: AnalysisTriggerConfig;
  visibleModuleIds: string[];
  selectedNodeId: string | null;
  camera: CameraState | null;
  graphNavigation: GraphNavigation | null;
  /** DSM view: package | file */
  dsmLevel?: "package" | "file";
  /** DSM view: partitioned | hierarchical */
  dsmOrdering?: "partitioned" | "hierarchical";
  /** LDM design rules for architecture conformance */
  designRules?: DesignRule[];
  /** True after the user finishes or skips the first-run setup wizard */
  setupWizardCompleted?: boolean;
}

export interface PersistedAppState extends PersistedUiState {
  analysisResult: AnalysisResult | null;
}

export const DEFAULT_PANEL_SIZES: PanelSizes = {
  leftWidth: 240,
  rightWidth: 360,
  bottomHeight: 200,
  leftTreeHeight: 50,
};

export function defaultPersistedState(): PersistedAppState {
  return {
    version: 1,
    panelSizes: { ...DEFAULT_PANEL_SIZES },
    settingsPanelOpen: false,
    projectPath: null,
    selectedRuleIds: [],
    ruleSettings: {},
    lspSettings: {},
    linterSettings: {},
    llmConfigurations: defaultLlmConfigurations(),
    aiValidationRuntime: defaultAiValidationRuntimeSettings(),
    analysisTriggers: defaultAnalysisTriggerConfig(),
    visibleModuleIds: [],
    selectedNodeId: null,
    camera: null,
    graphNavigation: null,
    dsmLevel: "package",
    dsmOrdering: "partitioned",
    designRules: defaultDesignRules(),
    setupWizardCompleted: false,
    analysisResult: null,
  };
}
