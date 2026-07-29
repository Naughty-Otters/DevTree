import type { AnalysisProgress, RuleTaskProgress } from "./types";

const PIPELINE_STAGES = [
  { id: "scanning", label: "Scan project files" },
  { id: "reading", label: "Read file contents" },
  { id: "lsp", label: "Start language servers" },
  { id: "analyzing", label: "Resolve imports & symbols" },
  { id: "validating", label: "Run validation rules" },
] as const;

const STAGE_ORDER = [
  "starting",
  "scanning",
  "reading",
  "lsp",
  "analyzing",
  "validating",
  "done",
] as const;

export function normalizeStage(stage: string): string {
  if (stage === "starting") return "scanning";
  return stage;
}

export function pipelineStageStatus(
  currentStage: string,
  pipelineStageId: string,
): RuleTaskProgress["status"] {
  const current = normalizeStage(currentStage);
  const currentIdx = STAGE_ORDER.indexOf(current as (typeof STAGE_ORDER)[number]);
  const stageIdx = STAGE_ORDER.indexOf(
    pipelineStageId as (typeof STAGE_ORDER)[number],
  );
  if (currentIdx < 0 || stageIdx < 0) return "pending";
  if (stageIdx < currentIdx) return "done";
  if (stageIdx === currentIdx) return "running";
  return "pending";
}

/** Use the task's real status — do not mark every pending rule as running during validation. */
export function effectiveRuleStatus(
  task: RuleTaskProgress,
): RuleTaskProgress["status"] {
  return task.status;
}

export function getPipelineStages(): readonly { id: string; label: string }[] {
  return PIPELINE_STAGES;
}

export function countActiveTasks(
  currentStage: string,
  ruleTasks: RuleTaskProgress[],
): number {
  const pipelineActive = PIPELINE_STAGES.filter(
    (stage) => pipelineStageStatus(currentStage, stage.id) === "running",
  ).length;
  const rulesActive = ruleTasks.filter((task) => task.status === "running").length;
  return pipelineActive + rulesActive;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ratioPercent(current: number, total: number): number | null {
  if (total <= 0) return null;
  return clampPercent((current / total) * 100);
}

/** Fill width for a pipeline stage row (0–100). Never returns indeterminate. */
export function pipelineStageFillPercent(
  currentStage: string,
  stageId: string,
  progress: AnalysisProgress | null,
): number {
  const status = pipelineStageStatus(currentStage, stageId);
  if (status === "done") return 100;
  if (status === "pending") return 0;

  if (progress && normalizeStage(progress.stage) === stageId) {
    const ratio = ratioPercent(progress.current, progress.total);
    if (ratio !== null) return Math.max(2, Math.min(99, ratio));
    if (progress.percent > 0) return Math.max(2, Math.min(99, progress.percent));
  }

  return 12;
}

/** Fill width for a validation rule row (0–100). */
export function ruleTaskFillPercent(
  task: RuleTaskProgress,
  progress: AnalysisProgress | null,
): number {
  if (task.status === "done" || task.status === "failed") return 100;
  if (task.status === "pending") return 0;

  if (progress?.stage === "validating") {
    const ratio = ratioPercent(progress.current, progress.total);
    if (ratio !== null) return Math.max(2, Math.min(99, ratio));
    if (progress.percent > 0) return Math.max(2, Math.min(99, progress.percent));
  }

  return 40;
}

export function overallProgressPercent(progress: AnalysisProgress | null): number {
  if (!progress) return 0;
  return clampPercent(progress.percent);
}

export function overallProgressMeta(progress: AnalysisProgress): string {
  const pct = overallProgressPercent(progress);
  const stage = progress.stage;
  if (progress.total > 0) {
    return `${stage} · ${pct}% · ${progress.current}/${progress.total}`;
  }
  return `${stage} · ${pct}%`;
}
