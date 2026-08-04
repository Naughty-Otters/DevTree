import type { LlmProviderInfo } from "../agent/types";
import type { LlmConfiguration } from "../validation/aiValidation";
import { configurationLabel } from "../validation/aiValidation";
import { t } from "../i18n";

export interface LlmConfigurationPickerOptions {
  configurations: LlmConfiguration[];
  providers: LlmProviderInfo[];
  value: string;
  allowGlobal?: boolean;
  disabled?: boolean;
  classPrefix?: "settings" | "rule-setting";
  onChange: (configId: string) => void;
}

export function createLlmConfigurationPicker(
  root: HTMLElement,
  options: LlmConfigurationPickerOptions,
): { update: (next: Partial<LlmConfigurationPickerOptions>) => void } {
  let state = { ...options };
  const prefix = state.classPrefix ?? "rule-setting";

  const select = document.createElement("select");
  select.className = `${prefix}-input ${prefix}-select`;

  root.append(fieldWrap(t("llm.configuration"), select, prefix));

  function render(): void {
    select.replaceChildren();
    if (state.allowGlobal) {
      const global = document.createElement("option");
      global.value = "";
      global.textContent = t("llm.useGlobalDefault");
      select.appendChild(global);
    }

    for (const config of state.configurations) {
      const option = document.createElement("option");
      option.value = config.id;
      const label = configurationLabel(config, state.providers);
      const provider = state.providers.find((entry) => entry.id === config.provider);
      option.textContent = provider ? `${label} (${provider.label})` : label;
      select.appendChild(option);
    }

    select.value = state.value || "";
    select.disabled = Boolean(state.disabled);
  }

  select.addEventListener("change", () => {
    state.onChange(select.value);
  });

  render();

  return {
    update(next) {
      state = { ...state, ...next, value: next.value ?? state.value };
      render();
    },
  };
}

function fieldWrap(
  label: string,
  control: HTMLElement,
  prefix: "settings" | "rule-setting",
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = prefix === "settings" ? "settings-field" : "rule-setting";
  const title = document.createElement("span");
  title.className = prefix === "settings" ? "settings-label" : "rule-setting-label";
  title.textContent = label;
  wrap.append(title, control);
  return wrap;
}
