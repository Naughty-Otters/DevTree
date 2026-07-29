import type { LlmProviderInfo } from "../agent/types";
import type { LlmConfiguration } from "../validation/aiValidation";
import {
  configurationLabel,
  createLlmConfiguration,
  ensureSingleGlobal,
  isLlmConfigurationReady,
  setGlobalConfiguration,
} from "../validation/aiValidation";
import { listLlmModels } from "../project/api";
import { createLlmConfigFields } from "./llmConfigFields";
import { lucideIcon } from "./icons";
import { Plus, Trash2 } from "lucide";

export interface LlmProviderConfigsPanelHandlers {
  onChange: (configs: LlmConfiguration[]) => void;
}

interface ModelState {
  models: string[];
  loading: boolean;
  error: string | null;
}

export function createLlmProviderConfigsPanel(
  root: HTMLElement,
  handlers: LlmProviderConfigsPanelHandlers,
): {
  setProviders: (providers: LlmProviderInfo[]) => void;
  setConfigs: (configs: LlmConfiguration[]) => void;
} {
  let providers: LlmProviderInfo[] = [];
  let configs: LlmConfiguration[] = [];
  const modelsByConfigId = new Map<string, ModelState>();
  const fieldUpdaters = new Map<
    string,
    ReturnType<typeof createLlmConfigFields>
  >();
  const fetchTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const hint = document.createElement("p");
  hint.className = "settings-hint";
  hint.textContent =
    "Add LLM configurations with API keys. Models are loaded from the provider after you enter a valid API key. Mark one configuration as the global default.";

  const list = document.createElement("div");
  list.className = "llm-provider-config-list";

  const addRow = document.createElement("div");
  addRow.className = "llm-provider-config-actions";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn-text";
  addButton.append(lucideIcon(Plus), document.createTextNode(" Add configuration"));
  addButton.addEventListener("click", () => {
    const next = ensureSingleGlobal([
      ...configs,
      createLlmConfiguration({
        isGlobal: configs.length === 0,
      }),
    ]);
    configs = next;
    handlers.onChange(configs);
    render();
  });

  addRow.appendChild(addButton);
  root.append(hint, list, addRow);

  function updateConfigs(next: LlmConfiguration[]): void {
    configs = ensureSingleGlobal(next);
    handlers.onChange(configs);
    render();
  }

  function modelStateFor(configId: string): ModelState {
    return (
      modelsByConfigId.get(configId) ?? {
        models: [],
        loading: false,
        error: null,
      }
    );
  }

  function updateModelFields(config: LlmConfiguration): void {
    const state = modelStateFor(config.id);
    fieldUpdaters.get(config.id)?.update({
      models: state.models,
      modelsLoading: state.loading,
      modelsError: state.error,
      value: { provider: config.provider, model: config.model },
    });
  }

  function scheduleModelFetch(config: LlmConfiguration): void {
    const existing = fetchTimers.get(config.id);
    if (existing) clearTimeout(existing);

    if (!config.apiKey.trim()) {
      modelsByConfigId.set(config.id, {
        models: [],
        loading: false,
        error: null,
      });
      updateModelFields(config);
      return;
    }

    modelsByConfigId.set(config.id, {
      models: modelStateFor(config.id).models,
      loading: true,
      error: null,
    });
    updateModelFields(config);

    const timer = setTimeout(() => {
      fetchTimers.delete(config.id);
      void fetchModels(config);
    }, 500);
    fetchTimers.set(config.id, timer);
  }

  async function fetchModels(config: LlmConfiguration): Promise<void> {
    if (!config.apiKey.trim()) return;

    modelsByConfigId.set(config.id, {
      models: [],
      loading: true,
      error: null,
    });
    updateModelFields(config);

    try {
      const models = await listLlmModels(config.provider, config.apiKey);
      modelsByConfigId.set(config.id, {
        models,
        loading: false,
        error: null,
      });

      if (models.length > 0) {
        if (!config.model || !models.includes(config.model)) {
          config.model = models[0]!;
          handlers.onChange(configs);
        }
      }
    } catch (error) {
      modelsByConfigId.set(config.id, {
        models: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    updateModelFields(config);
  }

  function render(): void {
    list.replaceChildren();
    fieldUpdaters.clear();

    if (providers.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-hint";
      empty.textContent = "Loading providers…";
      list.appendChild(empty);
      return;
    }

    if (configs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-hint settings-hint-warn";
      empty.textContent = "No configurations yet. Add one to enable AI validation.";
      list.appendChild(empty);
      return;
    }

    for (const config of configs) {
      list.appendChild(renderConfigCard(config));
      if (config.apiKey.trim() && modelStateFor(config.id).models.length === 0) {
        scheduleModelFetch(config);
      }
    }
  }

  function renderConfigCard(config: LlmConfiguration): HTMLElement {
    const card = document.createElement("div");
    card.className = "llm-provider-config-card";

    const header = document.createElement("div");
    header.className = "llm-provider-config-card-header";

    const title = document.createElement("span");
    title.className = "llm-provider-config-name";
    title.textContent = configurationLabel(config, providers);

    const status = document.createElement("span");
    status.className = `llm-provider-config-status${
      isLlmConfigurationReady(config) ? " is-configured" : ""
    }`;
    status.textContent = isLlmConfigurationReady(config) ? "Ready" : "Missing API key";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn-icon";
    deleteButton.title = "Remove configuration";
    deleteButton.appendChild(lucideIcon(Trash2));
    deleteButton.addEventListener("click", () => {
      const remaining = configs.filter((entry) => entry.id !== config.id);
      modelsByConfigId.delete(config.id);
      fieldUpdaters.delete(config.id);
      updateConfigs(remaining);
    });

    header.append(title, status, deleteButton);

    const nameInput = document.createElement("input");
    nameInput.className = "settings-input";
    nameInput.type = "text";
    nameInput.placeholder = "Configuration name (optional)";
    nameInput.value = config.name;
    nameInput.addEventListener("input", () => {
      config.name = nameInput.value;
      title.textContent = configurationLabel(config, providers);
      handlers.onChange(configs);
    });

    const apiKeyInput = document.createElement("input");
    apiKeyInput.className = "settings-input";
    apiKeyInput.type = "password";
    apiKeyInput.placeholder = "API key";
    apiKeyInput.autocomplete = "off";
    apiKeyInput.value = config.apiKey;
    apiKeyInput.addEventListener("input", () => {
      config.apiKey = apiKeyInput.value;
      status.textContent = isLlmConfigurationReady(config) ? "Ready" : "Missing API key";
      status.classList.toggle("is-configured", isLlmConfigurationReady(config));
      handlers.onChange(configs);
      scheduleModelFetch(config);
    });

    const globalWrap = document.createElement("label");
    globalWrap.className = "llm-provider-config-global";
    const globalInput = document.createElement("input");
    globalInput.type = "radio";
    globalInput.name = "llm-global-config";
    globalInput.checked = config.isGlobal;
    globalInput.addEventListener("change", () => {
      if (!globalInput.checked) return;
      updateConfigs(setGlobalConfiguration(configs, config.id));
    });
    const globalLabel = document.createElement("span");
    globalLabel.textContent = "Global default for AI validation";
    globalWrap.append(globalInput, globalLabel);

    const modelHost = document.createElement("div");
    modelHost.className = "llm-config-fields";
    const modelState = modelStateFor(config.id);
    const fields = createLlmConfigFields(modelHost, {
      providers,
      models: modelState.models,
      modelsLoading: modelState.loading,
      modelsError: modelState.error,
      value: { provider: config.provider, model: config.model },
      showApiKey: false,
      classPrefix: "settings",
      onChange: (value) => {
        if (!value.provider) return;
        config.provider = value.provider;
        config.model = value.model;
        title.textContent = configurationLabel(config, providers);
        handlers.onChange(configs);
      },
      onProviderChange: () => {
        config.model = "";
        scheduleModelFetch(config);
      },
    });
    fieldUpdaters.set(config.id, fields);

    card.append(
      header,
      fieldWrap("Name", nameInput),
      fieldWrap("API key", apiKeyInput),
      modelHost,
      globalWrap,
    );
    return card;
  }

  return {
    setProviders(next) {
      providers = next.length > 0 ? next : providers;
      render();
    },
    setConfigs(next) {
      configs = ensureSingleGlobal(next);
      render();
    },
  };
}

function fieldWrap(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "settings-field";
  const title = document.createElement("span");
  title.className = "settings-label";
  title.textContent = label;
  wrap.append(title, control);
  return wrap;
}
