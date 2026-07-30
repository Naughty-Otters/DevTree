export type AnalysisTriggerSource = "watch" | "cron";

export interface AnalysisTriggerEvent {
  source: AnalysisTriggerSource;
  projectPath: string;
  path?: string;
  message: string;
}

export interface AnalysisTriggerStatus {
  watchActive: boolean;
  watchPath?: string | null;
  watchDebounceMs: number;
  scheduleActive: boolean;
  cron?: string | null;
  nextRunAt?: string | null;
}

export interface AnalysisTriggerConfig {
  watchEnabled: boolean;
  watchDebounceMs: number;
  scheduleEnabled: boolean;
  cron: string;
}

export function defaultAnalysisTriggerConfig(): AnalysisTriggerConfig {
  return {
    watchEnabled: false,
    watchDebounceMs: 3000,
    scheduleEnabled: false,
    cron: "0 * * * *",
  };
}
