import type { AnalysisRule } from "../analysis/types";

export interface RulesPanelState {
  rules: AnalysisRule[];
  selected: Set<string>;
}

export function createRulesPanel(
  container: HTMLElement,
  state: RulesPanelState,
  onChange: (selected: Set<string>) => void,
): void {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "rules-header";
  header.innerHTML = `<span>${state.selected.size} of ${state.rules.length} selected</span>`;

  const selectAll = document.createElement("button");
  selectAll.className = "btn-text";
  selectAll.textContent = "Select all";
  selectAll.addEventListener("click", () => {
    state.rules.forEach((r) => state.selected.add(r.id));
    onChange(new Set(state.selected));
    renderRules(container, state, onChange);
  });

  const clearAll = document.createElement("button");
  clearAll.className = "btn-text";
  clearAll.textContent = "Clear";
  clearAll.addEventListener("click", () => {
    state.selected.clear();
    onChange(new Set(state.selected));
    renderRules(container, state, onChange);
  });

  header.append(selectAll, clearAll);
  container.appendChild(header);

  renderRules(container, state, onChange);
}

function renderRules(
  container: HTMLElement,
  state: RulesPanelState,
  onChange: (selected: Set<string>) => void,
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
  onChange: (selected: Set<string>) => void,
  container: HTMLElement,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "rule-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selected.has(rule.id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.selected.add(rule.id);
    } else {
      state.selected.delete(rule.id);
    }
    onChange(new Set(state.selected));
    renderRules(container, state, onChange);
  });

  const info = document.createElement("div");
  info.className = "rule-info";

  const name = document.createElement("div");
  name.className = "rule-name";
  name.textContent = rule.name;

  const desc = document.createElement("div");
  desc.className = "rule-desc";
  desc.textContent = rule.description;

  info.append(name, desc);
  label.append(checkbox, info);
  return label;
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
