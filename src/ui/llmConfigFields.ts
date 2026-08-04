import type { LlmProviderId, LlmProviderInfo } from "../agent/types";
import { t } from "../i18n";
import { formatModelLabel } from "../validation/llmCatalog";

export interface LlmConfigFieldsValue {
  provider: LlmProviderId | "";
  model: string;
  apiKey?: string;
}

export interface LlmConfigFieldsOptions {
  providers: LlmProviderInfo[];
  models: string[];
  modelsLoading?: boolean;
  modelsError?: string | null;
  value: LlmConfigFieldsValue;
  disabled?: boolean;
  allowGlobal?: boolean;
  showApiKey?: boolean;
  classPrefix?: "settings" | "rule-setting";
  /** Override hint when models list is empty (e.g. CLI backends). */
  emptyModelsHint?: string;
  onChange: (value: LlmConfigFieldsValue) => void;
  onProviderChange?: (providerId: LlmProviderId) => void;
}

export function createLlmConfigFields(
  root: HTMLElement,
  options: LlmConfigFieldsOptions,
): { update: (next: Partial<LlmConfigFieldsOptions>) => void } {
  let state = { ...options };
  const prefix = state.classPrefix ?? "settings";

  const providerSelect = document.createElement("select");
  providerSelect.className = `${prefix}-select`;

  const modelSelect = document.createElement("select");
  modelSelect.className = `${prefix}-input ${prefix}-select`;

  const modelHint = document.createElement("p");
  modelHint.className = `${prefix === "settings" ? "settings" : "rule-settings"}-hint`;

  const apiKeyInput = document.createElement("input");
  apiKeyInput.className = `${prefix}-input`;
  apiKeyInput.type = "password";
  apiKeyInput.placeholder = state.allowGlobal
    ? t("llm.useGlobal")
    : t("llm.apiKeyPlaceholder");
  apiKeyInput.autocomplete = "off";

  root.append(
    fieldWrap(t("llm.provider"), providerSelect, prefix),
    fieldWrap(t("llm.model"), modelSelect, prefix),
    modelHint,
  );

  if (state.showApiKey === true) {
    root.append(fieldWrap(t("llm.apiKey"), apiKeyInput, prefix));
  }

  function persist(): void {
    state.onChange({
      provider: providerSelect.value as LlmProviderId | "",
      model: modelSelect.value,
      ...(state.showApiKey === true ? { apiKey: apiKeyInput.value } : {}),
    });
  }

  function renderProviderOptions(): void {
    providerSelect.replaceChildren();
    if (state.allowGlobal) {
      const global = document.createElement("option");
      global.value = "";
      global.textContent = t("llm.useGlobal");
      providerSelect.appendChild(global);
    }
    for (const provider of state.providers) {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.label;
      providerSelect.appendChild(option);
    }
    providerSelect.value = state.value.provider || "";
  }

  function renderModelOptions(): void {
    modelSelect.replaceChildren();
    const providerId = providerSelect.value as LlmProviderId | "";
    if (!providerId) {
      if (state.allowGlobal) {
        const global = document.createElement("option");
        global.value = "";
        global.textContent = t("llm.useGlobal");
        modelSelect.appendChild(global);
      }
      modelSelect.value = state.value.model || "";
      modelSelect.disabled = true;
      modelHint.textContent = "";
      return;
    }

    if (state.modelsLoading) {
      const loading = document.createElement("option");
      loading.value = "";
      loading.textContent = t("llm.loadingModels");
      modelSelect.appendChild(loading);
      modelSelect.disabled = true;
      modelHint.textContent = t("llm.fetchingModels");
      return;
    }

    if (state.modelsError) {
      const error = document.createElement("option");
      error.value = "";
      error.textContent = t("llm.couldNotLoadModels");
      modelSelect.appendChild(error);
      modelSelect.disabled = true;
      modelHint.textContent = state.modelsError;
      modelHint.classList.add("settings-hint-warn");
      return;
    }

    modelHint.classList.remove("settings-hint-warn");

    if (state.models.length === 0) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = state.emptyModelsHint
        ? t("llm.loadingModels")
        : t("llm.enterApiKeyToLoad");
      modelSelect.appendChild(empty);
      modelSelect.disabled = true;
      modelHint.textContent =
        state.emptyModelsHint ?? t("llm.addApiKeyHint");
      return;
    }

    modelSelect.disabled = Boolean(state.disabled);
    modelHint.textContent = t("llm.modelsAvailable", {
      n: state.models.length,
    });

    for (const model of state.models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = formatModelLabel(model);
      modelSelect.appendChild(option);
    }

    const currentModel = state.value.model.trim();
    if (currentModel && !state.models.includes(currentModel)) {
      const custom = document.createElement("option");
      custom.value = currentModel;
      custom.textContent = formatModelLabel(currentModel);
      modelSelect.appendChild(custom);
    }

    modelSelect.value =
      currentModel && (state.models.includes(currentModel) || currentModel)
        ? currentModel
        : state.models[0] ?? "";
  }

  function syncFromValue(): void {
    renderProviderOptions();
    renderModelOptions();
    if (state.showApiKey === true) {
      apiKeyInput.value = state.value.apiKey ?? "";
      apiKeyInput.disabled = Boolean(state.disabled);
    }
    providerSelect.disabled = Boolean(state.disabled);
  }

  providerSelect.addEventListener("change", () => {
    const providerId = providerSelect.value as LlmProviderId | "";
    if (!providerId) {
      modelSelect.value = "";
      persist();
      renderModelOptions();
      return;
    }
    state.value = { ...state.value, provider: providerId, model: "" };
    persist();
    state.onProviderChange?.(providerId);
    renderModelOptions();
  });

  modelSelect.addEventListener("change", () => {
    persist();
  });

  apiKeyInput.addEventListener("input", () => {
    if (state.showApiKey === true) persist();
  });

  syncFromValue();

  return {
    update(next) {
      state = { ...state, ...next, value: next.value ?? state.value };
      syncFromValue();
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
