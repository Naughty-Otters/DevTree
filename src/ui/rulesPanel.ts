import type { AnalysisRule, RuleSettingDef, RuleSettingsMap } from "../analysis/types";
import { lucideIcon } from "./icons";
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

export function createRulesPanel(
  container: HTMLElement,
  state: RulesPanelState,
  onChange: (selected: Set<string>, settings: RuleSettingsMap) => void,
): void {
  if (state.expandedRuleId === undefined) {
    state.expandedRuleId = null;
  }
  container.innerHTML = "";

  if (state.loading) {
    const loading = document.createElement("div");
    loading.className = "panel-empty panel-loading";
    loading.textContent = "Loading analysis rules…";
    container.appendChild(loading);
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
    renderRules(container, state, onChange);
  });

  const clearAll = document.createElement("button");
  clearAll.className = "btn-text";
  clearAll.textContent = "Clear";
  clearAll.addEventListener("click", () => {
    state.selected.clear();
    onChange(new Set(state.selected), { ...state.settings });
    renderRules(container, state, onChange);
  });

  header.append(selectAll, clearAll);
  container.appendChild(header);

  renderRules(container, state, onChange);
}

function renderRules(
  container: HTMLElement,
  state: RulesPanelState,
  onChange: (selected: Set<string>, settings: RuleSettingsMap) => void,
): void {
  const existing = container.querySelector(".rules-list");
  if (existing) existing.remove();

  const list = document.createElement("div");
  list.className = "rules-list";

  const byCategory = groupByCategory(state.rules);
  for (const [category, rules] of Object.entries(byCategory)) {
    const catHeader = document.createElement("div");
    catHeader.className = "rules-category";
    catHeader.textContent = category;
    list.appendChild(catHeader);

    for (const rule of rules) {
      list.appendChild(ruleItem(rule, state, onChange, container));
    }
  }

  container.appendChild(list);

  const header = container.querySelector(".rules-header span");
  if (header) {
    header.textContent = `${state.selected.size} of ${state.rules.length} selected`;
  }
}

function ruleItem(
  rule: AnalysisRule,
  state: RulesPanelState,
  onChange: (selected: Set<string>, settings: RuleSettingsMap) => void,
  container: HTMLElement,
): HTMLElement {
  const enabled = state.selected.has(rule.id);
  const settings = rule.settings ?? [];
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
    renderRules(container, state, onChange);
  });

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rule-item-toggle";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.disabled = settings.length === 0;

  const info = document.createElement("div");
  info.className = "rule-info";

  const name = document.createElement("div");
  name.className = "rule-name";
  name.textContent = rule.name;

  const desc = document.createElement("div");
  desc.className = "rule-desc";
  desc.textContent = rule.description;

  info.append(name, desc);

  const chevron = document.createElement("span");
  chevron.className = "rule-item-chevron";
  chevron.setAttribute("aria-hidden", "true");
  if (settings.length > 0) {
    chevron.appendChild(
      lucideIcon(ChevronDown, {
        size: 14,
        class: "lucide-icon",
        "stroke-width": 1.75,
      }),
    );
  }

  toggle.append(info, chevron);
  toggle.addEventListener("click", () => {
    if (settings.length === 0) return;
    state.expandedRuleId =
      state.expandedRuleId === rule.id ? null : rule.id;
    renderRules(container, state, onChange);
  });

  row.append(checkbox, toggle);
  wrap.appendChild(row);

  if (settings.length > 0 && expanded) {
    const settingsEl = document.createElement("div");
    settingsEl.className = "rule-settings";
    for (const def of settings) {
      settingsEl.appendChild(
        settingControl(rule.id, def, state, onChange, !enabled),
      );
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
): HTMLElement {
  const row = document.createElement("div");
  row.className = "rule-setting";

  const label = document.createElement("label");
  label.className = "rule-setting-label";
  label.textContent = def.label;

  const current =
    state.settings[ruleId]?.[def.key] ?? def.default;

  if (def.kind === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "rule-setting-input";
    input.checked = Boolean(current);
    input.disabled = disabled;
    input.addEventListener("change", () => {
      if (!state.settings[ruleId]) state.settings[ruleId] = {};
      state.settings[ruleId][def.key] = input.checked;
      onChange(new Set(state.selected), { ...state.settings });
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
      if (!state.settings[ruleId]) state.settings[ruleId] = {};
      state.settings[ruleId][def.key] = n;
      onChange(new Set(state.selected), { ...state.settings });
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
