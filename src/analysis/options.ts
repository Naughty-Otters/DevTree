export type ModuleGranularity = "file" | "folder";

export interface AnalysisOptions {
  moduleGranularity: ModuleGranularity;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  moduleGranularity: "file",
};
