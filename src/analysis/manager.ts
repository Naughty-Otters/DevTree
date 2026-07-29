import type { AnalysisProgress, AnalysisResult, RuleSettingsMap, RuleTaskProgress } from "./types";
import type { LspSettingsMap } from "../lsp/types";
import type { LinterSettingsMap } from "../linter/types";
import { cancelAnalysis, runAnalysis } from "../project/api";

export type AnalysisRunStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface AnalysisRun {
  id: string;
  label: string;
  startedAt: number;
  status: AnalysisRunStatus;
  progress: AnalysisProgress | null;
  ruleTasks: RuleTaskProgress[];
  result: AnalysisResult | null;
  error: string | null;
}

export interface StartAnalysisParams {
  projectPath: string;
  rules: { id: string; name: string }[];
  ruleSettings: RuleSettingsMap;
  lspSettings: LspSettingsMap;
  linterSettings: LinterSettingsMap;
}

export interface AnalysisManagerHandlers {
  onRunsChanged: (runs: AnalysisRun[]) => void;
  onRunCompleted: (run: AnalysisRun) => void;
  onRunFailed?: (run: AnalysisRun) => void;
}

export interface AnalysisManager {
  getRuns: () => AnalysisRun[];
  getLatestRunId: () => string | null;
  hasRunning: () => boolean;
  start: (params: StartAnalysisParams) => string;
  cancel: (id: string) => void;
  cancelAll: () => void;
  clearFinished: () => void;
}

function mergeRuleTasks(
  existing: RuleTaskProgress[],
  incoming: RuleTaskProgress[],
): RuleTaskProgress[] {
  const map = new Map(existing.map((task) => [task.ruleId, { ...task }]));
  for (const task of incoming) {
    if (task.ruleId.startsWith("language_linters:")) {
      map.delete("language_linters");
    }
    const prev = map.get(task.ruleId);
    map.set(task.ruleId, prev ? { ...prev, ...task } : { ...task });
  }
  return Array.from(map.values());
}

function ruleIdsFromParams(rules: { id: string; name: string }[]): string[] {
  return rules.map((rule) => rule.id);
}

function isCancelledError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return msg.includes("cancel");
}

export function createAnalysisManager(
  handlers: AnalysisManagerHandlers,
): AnalysisManager {
  const runs = new Map<string, AnalysisRun>();
  let latestRunId: string | null = null;
  let runCounter = 0;

  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  let notifyPending = false;

  function flushNotify(): void {
    const list = Array.from(runs.values()).sort(
      (a, b) => a.startedAt - b.startedAt,
    );
    handlers.onRunsChanged(list);
  }

  function notify(immediate = false): void {
    if (immediate) {
      if (notifyTimer !== null) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
      notifyPending = false;
      flushNotify();
      return;
    }
    if (notifyPending) return;
    notifyPending = true;
    notifyTimer = setTimeout(() => {
      notifyPending = false;
      notifyTimer = null;
      flushNotify();
    }, 100);
  }

  function getRun(id: string): AnalysisRun | undefined {
    return runs.get(id);
  }

  function start(params: StartAnalysisParams): string {
    runCounter += 1;
    const id = crypto.randomUUID();
    latestRunId = id;

    const ruleTasks: RuleTaskProgress[] = params.rules.map((rule) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      status: "pending",
    }));

    const run: AnalysisRun = {
      id,
      label: `Run #${runCounter} · ${params.rules.length} rule${params.rules.length === 1 ? "" : "s"}`,
      startedAt: Date.now(),
      status: "running",
      progress: {
        analysisId: id,
        stage: "starting",
        message: "Preparing analysis…",
        current: 0,
        total: params.rules.length,
        percent: 0,
        ruleTasks: [...ruleTasks],
      },
      ruleTasks,
      result: null,
      error: null,
    };
    runs.set(id, run);
    notify(true);

    void runAnalysis(
      params.projectPath,
      ruleIdsFromParams(params.rules),
      id,
      (progress) => {
        const current = getRun(id);
        if (!current || current.status !== "running") return;
        current.progress = progress;
        if (progress.ruleTasks?.length) {
          current.ruleTasks = mergeRuleTasks(current.ruleTasks, progress.ruleTasks);
          current.progress = {
            ...progress,
            ruleTasks: current.ruleTasks,
          };
        }
        if (progress.stage === "done") {
          for (const task of current.ruleTasks) {
            if (task.status !== "done" && task.status !== "failed") {
              task.status = "done";
            }
          }
        }
        notify();
      },
      params.ruleSettings,
      params.lspSettings,
      params.linterSettings,
    )
      .then((result) => {
        const current = getRun(id);
        if (!current || current.status !== "running") return;
        current.status = "completed";
        current.progress = {
          analysisId: id,
          stage: "done",
          message: "Analysis complete",
          current: 0,
          total: 0,
          percent: 100,
        };
        current.result = result;
        notify(true);
        handlers.onRunCompleted(current);
        runs.delete(id);
        notify(true);
      })
      .catch((err) => {
        const current = getRun(id);
        if (!current) return;
        if (current.status === "cancelled") {
          runs.delete(id);
          notify(true);
          return;
        }
        if (isCancelledError(err)) {
          current.status = "cancelled";
          current.error = null;
        } else {
          current.status = "failed";
          current.error = String(err);
          handlers.onRunFailed?.(current);
        }
        notify(true);
        runs.delete(id);
        notify(true);
      });

    return id;
  }

  function cancel(id: string): void {
    const run = getRun(id);
    if (!run || run.status !== "running") return;
    run.status = "cancelled";
    run.progress = {
      ...(run.progress ?? {
        analysisId: id,
        stage: "cancelled",
        message: "Cancelling…",
        current: 0,
        total: 0,
        percent: 0,
      }),
      stage: "cancelled",
      message: "Cancelling…",
    };
    notify(true);
    void cancelAnalysis(id);
    runs.delete(id);
    notify(true);
  }

  function cancelAll(): void {
    for (const run of runs.values()) {
      if (run.status === "running") {
        cancel(run.id);
      }
    }
  }

  function clearFinished(): void {
    for (const [id, run] of runs) {
      if (run.status !== "running") {
        runs.delete(id);
      }
    }
    notify();
  }

  return {
    getRuns: () =>
      Array.from(runs.values()).sort((a, b) => a.startedAt - b.startedAt),
    getLatestRunId: () => latestRunId,
    hasRunning: () =>
      Array.from(runs.values()).some((run) => run.status === "running"),
    start,
    cancel,
    cancelAll,
    clearFinished,
  };
}
