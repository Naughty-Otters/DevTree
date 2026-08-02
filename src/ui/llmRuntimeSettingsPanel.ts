import type { AiValidationRuntimeSettings } from "../validation/aiValidation";
import {
  clampRuntimeSettings,
  defaultAiValidationRuntimeSettings,
  RUNTIME_TOKEN_LIMITS,
  RUNTIME_TURNS_LIMITS,
} from "../validation/aiValidation";

export interface LlmRuntimeSettingsPanelHandlers {
  onChange: (settings: AiValidationRuntimeSettings) => void;
}

export function createLlmRuntimeSettingsPanel(
  root: HTMLElement,
  handlers: LlmRuntimeSettingsPanelHandlers,
): {
  setSettings: (settings: AiValidationRuntimeSettings) => void;
} {
  let settings: AiValidationRuntimeSettings = defaultAiValidationRuntimeSettings();

  const hint = document.createElement("p");
  hint.className = "settings-hint";
  hint.textContent =
    "Budgets stop AI validation when either the turn or token limit is reached (whichever comes first). Each turn is one model round (often with tool calls like grep or read_files).";

  const maxTurnsInput = numberField(
    "AI validation turn budget",
    `Tool-call rounds for the AI validation session base (4–${RUNTIME_TURNS_LIMITS.validationMax}). Scaled up when multiple AI phases run together.`,
    RUNTIME_TURNS_LIMITS.min,
    RUNTIME_TURNS_LIMITS.validationMax,
    () => settings.maxTurns,
    (value) => {
      settings = clampRuntimeSettings({ ...settings, maxTurns: value });
      handlers.onChange(settings);
    },
  );

  const maxTokensInput = numberField(
    "AI validation token budget (0 = unlimited)",
    `Caps billed total tokens for the AI validation session (0, or ${RUNTIME_TOKEN_LIMITS.minWhenSet.toLocaleString()}–${RUNTIME_TOKEN_LIMITS.max.toLocaleString()}).`,
    0,
    RUNTIME_TOKEN_LIMITS.max,
    () => settings.maxTokens,
    (value) => {
      settings = clampRuntimeSettings({ ...settings, maxTokens: value });
      handlers.onChange(settings);
    },
  );

  const agentMaxTurnsInput = numberField(
    "Agent turn budget",
    `Tool-call rounds for interactive agent skills (4–${RUNTIME_TURNS_LIMITS.agentMax})`,
    RUNTIME_TURNS_LIMITS.min,
    RUNTIME_TURNS_LIMITS.agentMax,
    () => settings.agentMaxTurns,
    (value) => {
      settings = clampRuntimeSettings({ ...settings, agentMaxTurns: value });
      handlers.onChange(settings);
    },
  );

  root.append(hint, maxTurnsInput.wrap, maxTokensInput.wrap, agentMaxTurnsInput.wrap);

  return {
    setSettings(next) {
      settings = clampRuntimeSettings(next);
      maxTurnsInput.setValue(settings.maxTurns);
      maxTokensInput.setValue(settings.maxTokens);
      agentMaxTurnsInput.setValue(settings.agentMaxTurns);
    },
  };
}

function numberField(
  label: string,
  description: string,
  min: number,
  max: number,
  getValue: () => number,
  onChange: (value: number) => void,
): { wrap: HTMLElement; setValue: (value: number) => void } {
  const wrap = document.createElement("label");
  wrap.className = "settings-field";

  const title = document.createElement("span");
  title.className = "settings-label";
  title.textContent = label;

  const desc = document.createElement("span");
  desc.className = "settings-hint";
  desc.textContent = description;

  const input = document.createElement("input");
  input.className = "settings-input";
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = String(getValue());

  input.addEventListener("change", () => {
    let value = Number(input.value);
    if (!Number.isFinite(value)) value = getValue();
    value = Math.min(max, Math.max(min, Math.round(value)));
    input.value = String(value);
    onChange(value);
  });

  wrap.append(title, desc, input);

  return {
    wrap,
    setValue(value) {
      input.value = String(value);
    },
  };
}
