import type { AnalysisRule, RuleSettingDef, RuleSettingsMap } from "../analysis/types";
import type { LlmConfiguration } from "../validation/aiValidation";
import {
  AI_LLM_SETTING_KEYS,
  aiRuleCategoryLabel,
  configuredLlmConfigurations,
  getGlobalConfiguration,
  isAiValidationRuleId,
  isArchitectureAssessmentKey,
  isCleanCodePrincipleKey,
  isCodeReviewLensKey,
  shouldShowAiRuleSetting,
} from "../validation/aiValidation";
import type { LlmProviderInfo } from "../agent/types";
import { effectiveLlmModel } from "../validation/llmCatalog";
import { createLlmConfigurationPicker } from "./llmConfigurationPicker";
import { lucideIcon } from "./icons";
import { createLoadingPlaceholder } from "./loadingPlaceholder";
import { ChevronDown } from "lucide";

export interface RulesPanelState {
  rules: AnalysisRule[];
  selected: Set<string>;
  settings: RuleSettingsMap;
  /** Only one rule's settings accordion open at a time. */
  expandedRuleId: string | null;
  /** True while analysis rules are loading from the backend. */
  loading?: boolean;
  loadError?: string | null;
}

export interface RulesPanelContext {
  llmProviders: LlmProviderInfo[];
  llmConfigurations: LlmConfiguration[];
}

export function createRulesPanel(
  container: HTMLElement,
  state: RulesPanelState,
  onChange: (selected: Set<string>, settings: RuleSettingsMap) => void,
  context?: RulesPanelContext,
): void {
  if (state.expandedRuleId === undefined) {
    state.expandedRuleId = null;
  }
  container.innerHTML = "";

  if (state.loading) {
    container.appendChild(
      createLoadingPlaceholder({
        title: "Loading analysis rules…",
        size: "panel",
      }),
    );
    return;
  }

  if (state.loadError) {
    const err = document.createElement("div");
    err.className = "panel-empty panel-error";
    err.textContent = state.loadError;
    container.appendChild(err);
    return;
  }

  if (state.rules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No analysis rules available";
    container.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "rules-header";
  header.innerHTML = `<span>${state.selected.size} of ${state.rules.length} selected</span>`;

  const selectAll = document.createElement("button");
  selectAll.className = "btn-text";
  selectAll.textContent = "Select all";
  selectAll.addEventListener("click", () => {
    state.rules.forEach((r) => state.selected.add(r.id));
    onChange(new Set(state.selected), { ...state.settings });
    renderRules(container, state, onChange, context);
  });

  const clearAll = document.createElement("button");
  clearAll.className = "btn-text";
  clearAll.textContent = "Clear";
  clearAll.addEventListener("click", () => {
    state.selected.clear();
    onChange(new Set(state.selected), { ...state.settings });
    renderRules(container, state, onChange, context);
  });

  header.append(selectAll, clearAll);
  container.appendChild(header);

  renderRules(container, state, onChange, context);
}

function renderRules(
  container: HTMLElement,
  state: RulesPanelState,
  onChange: (selected: Set<string>, settings: RuleSettingsMap) => void,
  context?: RulesPanelContext,
): void {
  const existing = container.querySelector(".rules-list");
  if (existing) existing.remove();

  const list = document.createElement("div");
  list.className = "rules-list";

  const byCategory = groupByCategory(state.rules);
  for (const [category, rules] of Object.entries(byCategory)) {
    const catHeader = document.createElement("div");
    catHeader.className = "rules-category";
    catHeader.textContent = aiRuleCategoryLabel(category);
    list.appendChild(catHeader);

    for (const rule of rules) {
      list.appendChild(ruleItem(rule, state, onChange, container, context));
    }
  }

  container.appendChild(list);

  const header = container.querySelector(".rules-header span");
  if (header) {
    header.textContent = `${state.selected.size} of ${state.rules.length} selected`;
  }
}

function ruleSettingsFor(
  rule: AnalysisRule,
  context?: RulesPanelContext,
): RuleSettingDef[] {
  if ((rule.settings?.length ?? 0) > 0) {
    return rule.settings ?? [];
  }
  if (isAiValidationRuleId(rule.id) && context?.llmProviders.length) {
    return [];
  }
  return rule.settings ?? [];
}

function ruleItem(
  rule: AnalysisRule,
  state: RulesPanelState,
  onChange: (selected: Set<string>, settings: RuleSettingsMap) => void,
  container: HTMLElement,
  context?: RulesPanelContext,
): HTMLElement {
  const enabled = state.selected.has(rule.id);
  const settings = ruleSettingsFor(rule, context);
  const expanded = state.expandedRuleId === rule.id;
  const wrap = document.createElement("div");
  wrap.className = `rule-item${enabled ? "" : " rule-item-disabled"}${
    expanded ? " is-expanded" : ""
  }`;

  const row = document.createElement("div");
  row.className = "rule-item-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = enabled;
  checkbox.title = enabled ? "Disable rule" : "Enable rule";
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.selected.add(rule.id);
    } else {
      state.selected.delete(rule.id);
    }
    onChange(new Set(state.selected), { ...state.settings });
    renderRules(container, state, onChange, context);
  });

  const info = document.createElement("button");
  info.type = "button";
  info.className = "rule-info";
  info.title = enabled ? "Disable rule" : "Enable rule";

  const name = document.createElement("div");
  name.className = "rule-name";
  name.textContent = rule.name;

  const desc = document.createElement("div");
  desc.className = "rule-desc";
  desc.textContent = rule.description;

  info.append(name, desc);
  info.addEventListener("click", () => {
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event("change"));
  });

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "rule-item-expand";
  expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  expandBtn.disabled = settings.length === 0;
  expandBtn.title =
    settings.length === 0
      ? "No settings"
      : expanded
        ? "Collapse settings"
        : "Expand settings";
  expandBtn.setAttribute(
    "aria-label",
    settings.length === 0
      ? "No settings"
      : `Expand or collapse settings for ${rule.name}`,
  );

  if (settings.length > 0) {
    const chevron = document.createElement("span");
    chevron.className = "rule-item-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.appendChild(
      lucideIcon(ChevronDown, {
        size: 14,
        class: "lucide-icon",
        "stroke-width": 1.75,
      }),
    );
    expandBtn.appendChild(chevron);
    expandBtn.addEventListener("click", () => {
      state.expandedRuleId =
        state.expandedRuleId === rule.id ? null : rule.id;
      renderRules(container, state, onChange, context);
    });
  }

  row.append(checkbox, info, expandBtn);
  wrap.appendChild(row);

  if (settings.length > 0 && expanded) {
    const settingsEl = document.createElement("div");
    settingsEl.className = "rule-settings";

    if (isAiValidationRuleId(rule.id) && context) {
      const hint = document.createElement("p");
      hint.className = "rule-settings-hint";
      const global = getGlobalConfiguration(context.llmConfigurations);
      if (global) {
        const providerLabel =
          context.llmProviders.find((p) => p.id === global.provider)?.label ??
          global.provider;
        const modelLabel = effectiveLlmModel(global.model) || "No model selected";
        const name = global.name.trim();
        hint.textContent = name
          ? `Global LLM: ${name} (${providerLabel} / ${modelLabel})`
          : `Global LLM: ${providerLabel} / ${modelLabel}`;
      } else {
        hint.className = "rule-settings-hint settings-hint-warn";
        hint.textContent =
          "No global LLM configured. Add one in Settings → LLM Configurations.";
      }
      settingsEl.appendChild(hint);
    }

    const overrideEnabled = Boolean(
      state.settings[rule.id]?.[AI_LLM_SETTING_KEYS.override],
    );

    let archAssessmentHeaderAdded = false;
    let codeReviewLensHeaderAdded = false;
    let cleanCodePrincipleHeaderAdded = false;

    for (const def of settings) {
      if (isAiValidationRuleId(rule.id) && !shouldShowAiRuleSetting(rule.id, def.key)) {
        continue;
      }

      if (
        rule.id === "ai_architecture" &&
        isArchitectureAssessmentKey(def.key) &&
        !archAssessmentHeaderAdded
      ) {
        archAssessmentHeaderAdded = true;
        const archHeader = document.createElement("p");
        archHeader.className = "rule-settings-hint";
        archHeader.textContent =
          "Architecture assessments to run (after discovering and mapping the project):";
        settingsEl.appendChild(archHeader);
      }

      if (
        rule.id === "ai_code_review" &&
        isCodeReviewLensKey(def.key) &&
        !codeReviewLensHeaderAdded
      ) {
        codeReviewLensHeaderAdded = true;
        const reviewHeader = document.createElement("p");
        reviewHeader.className = "rule-settings-hint";
        reviewHeader.textContent =
          "Code review lenses to inject into the run instructions:";
        settingsEl.appendChild(reviewHeader);
      }

      if (
        rule.id === "ai_clean_code" &&
        isCleanCodePrincipleKey(def.key) &&
        !cleanCodePrincipleHeaderAdded
      ) {
        cleanCodePrincipleHeaderAdded = true;
        const cleanHeader = document.createElement("p");
        cleanHeader.className = "rule-settings-hint";
        cleanHeader.textContent =
          "Clean Code principles to apply to current workspace changes:";
        settingsEl.appendChild(cleanHeader);
      }

      settingsEl.appendChild(
        settingControl(
          rule.id,
          def,
          state,
          onChange,
          !enabled,
          () => renderRules(container, state, onChange, context),
        ),
      );
    }

    if (isAiValidationRuleId(rule.id) && context && overrideEnabled) {
      const available = configuredLlmConfigurations(context.llmConfigurations);
      if (available.length === 0) {
        const noProviders = document.createElement("p");
        noProviders.className = "rule-settings-hint settings-hint-warn";
        noProviders.textContent =
          "No configured LLM entries. Add API keys in Settings → LLM Configurations.";
        settingsEl.appendChild(noProviders);
      } else {
        const llmHost = document.createElement("div");
        llmHost.className = "rule-llm-config";
        settingsEl.appendChild(llmHost);

        const configId = String(
          state.settings[rule.id]?.[AI_LLM_SETTING_KEYS.configId] ?? "",
        );

        createLlmConfigurationPicker(llmHost, {
          configurations: available,
          providers: context.llmProviders,
          value: configId,
          allowGlobal: true,
          disabled: !enabled,
          classPrefix: "rule-setting",
          onChange: (nextConfigId) => {
            if (!state.settings[rule.id]) state.settings[rule.id] = {};
            state.settings[rule.id][AI_LLM_SETTING_KEYS.configId] = nextConfigId;
            delete state.settings[rule.id][AI_LLM_SETTING_KEYS.provider];
            delete state.settings[rule.id][AI_LLM_SETTING_KEYS.model];
            onChange(new Set(state.selected), { ...state.settings });
          },
        });
      }
    }
    wrap.appendChild(settingsEl);
  }

  return wrap;
}

function settingControl(
  ruleId: string,
  def: RuleSettingDef,
  state: RulesPanelState,
  onChange: (selected: Set<string>, settings: RuleSettingsMap) => void,
  disabled: boolean,
  onUpdated?: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "rule-setting";

  const label = document.createElement("label");
  label.className = "rule-setting-label";
  label.textContent = def.label;

  const current =
    state.settings[ruleId]?.[def.key] ?? def.default;

  const setValue = (value: string | number | boolean) => {
    if (!state.settings[ruleId]) state.settings[ruleId] = {};
    state.settings[ruleId][def.key] = value;
    onChange(new Set(state.selected), { ...state.settings });
    onUpdated?.();
  };

  if (def.kind === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "rule-setting-input";
    input.checked = Boolean(current);
    input.disabled = disabled;
    input.addEventListener("change", () => {
      setValue(input.checked);
    });
    row.append(label, input);
  } else if (def.kind === "select") {
    const select = document.createElement("select");
    select.className = "rule-setting-input rule-setting-select";
    select.disabled = disabled;

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Use global";
    select.appendChild(empty);

    for (const option of def.options ?? []) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      select.appendChild(opt);
    }

    select.value = String(current ?? "");
    select.addEventListener("change", () => {
      setValue(select.value);
    });
    row.append(label, select);
  } else if (def.kind === "string" || def.kind === "password") {
    const input = document.createElement("input");
    input.type = def.kind === "password" ? "password" : "text";
    input.className = "rule-setting-input rule-setting-text";
    input.value = String(current ?? "");
    input.disabled = disabled;
    input.autocomplete = def.kind === "password" ? "off" : "on";
    input.addEventListener("input", () => {
      setValue(input.value);
    });
    row.append(label, input);
  } else {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "rule-setting-input rule-setting-number";
    input.value = String(current);
    if (def.min != null) input.min = String(def.min);
    if (def.max != null) input.max = String(def.max);
    input.disabled = disabled;
    input.addEventListener("change", () => {
      let n = Number(input.value);
      if (!Number.isFinite(n)) n = Number(def.default) || 0;
      if (def.min != null) n = Math.max(def.min, n);
      if (def.max != null) n = Math.min(def.max, n);
      input.value = String(n);
      setValue(n);
    });
    row.append(label, input);
  }

  return row;
}

function groupByCategory(
  rules: AnalysisRule[],
): Record<string, AnalysisRule[]> {
  const groups: Record<string, AnalysisRule[]> = {};
  for (const rule of rules) {
    const cat = rule.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(rule);
  }
  return groups;
}
