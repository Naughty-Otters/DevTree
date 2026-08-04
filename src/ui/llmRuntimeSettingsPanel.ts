import type { AiValidationRuntimeSettings } from "../validation/aiValidation";
import {
  clampRuntimeSettings,
  defaultAiValidationRuntimeSettings,
  RUNTIME_TOKEN_LIMITS,
  RUNTIME_TURNS_LIMITS,
} from "../validation/aiValidation";
import { getLocaleTag, t } from "../i18n";

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
  hint.textContent = t("llm.runtimeHint");

  const maxTurnsInput = numberField(
    t("llm.runtime.maxTurns"),
    t("llm.runtime.maxTurnsDesc", {
      min: RUNTIME_TURNS_LIMITS.min,
      max: RUNTIME_TURNS_LIMITS.validationMax,
    }),
    RUNTIME_TURNS_LIMITS.min,
    RUNTIME_TURNS_LIMITS.validationMax,
    () => settings.maxTurns,
    (value) => {
      settings = clampRuntimeSettings({ ...settings, maxTurns: value });
      handlers.onChange(settings);
    },
  );

  const locale = getLocaleTag();
  const maxTokensInput = numberField(
    t("llm.runtime.maxTokens"),
    t("llm.runtime.maxTokensDesc", {
      minWhenSet: RUNTIME_TOKEN_LIMITS.minWhenSet.toLocaleString(locale),
      max: RUNTIME_TOKEN_LIMITS.max.toLocaleString(locale),
    }),
    0,
    RUNTIME_TOKEN_LIMITS.max,
    () => settings.maxTokens,
    (value) => {
      settings = clampRuntimeSettings({ ...settings, maxTokens: value });
      handlers.onChange(settings);
    },
  );

  const agentMaxTurnsInput = numberField(
    t("llm.runtime.agentMaxTurns"),
    t("llm.runtime.agentMaxTurnsDesc", {
      min: RUNTIME_TURNS_LIMITS.min,
      max: RUNTIME_TURNS_LIMITS.agentMax,
    }),
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
