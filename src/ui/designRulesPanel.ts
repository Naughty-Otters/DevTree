import type { DesignRule } from "../analysis/designRules";
import { newRuleId } from "../analysis/designRules";
import { t } from "../i18n";

export interface DesignRulesPanelHandlers {
  onChange: (rules: DesignRule[]) => void;
  onSuggestLayers?: () => void;
  packageIds?: string[];
}

export function createDesignRulesPanel(
  container: HTMLElement,
  rules: DesignRule[],
  handlers: DesignRulesPanelHandlers,
): void {
  container.replaceChildren();
  container.classList.add("design-rules-panel");

  const intro = document.createElement("p");
  intro.className = "design-rules-intro";
  intro.textContent = t("designRules.intro");
  container.appendChild(intro);

  const actions = document.createElement("div");
  actions.className = "design-rules-actions";

  const addLayers = document.createElement("button");
  addLayers.type = "button";
  addLayers.className = "btn btn-ghost";
  addLayers.textContent = t("designRules.addLayerStack");
  addLayers.addEventListener("click", () => {
    const pkgs = handlers.packageIds ?? [];
    handlers.onChange([
      ...rules,
      {
        id: newRuleId(),
        kind: "layers",
        layers: pkgs.length > 0 ? [...pkgs] : [],
        enabled: true,
      },
    ]);
  });

  const addForbid = document.createElement("button");
  addForbid.type = "button";
  addForbid.className = "btn btn-ghost";
  addForbid.textContent = t("designRules.addForbidRule");
  addForbid.addEventListener("click", () => {
    handlers.onChange([
      ...rules,
      {
        id: newRuleId(),
        kind: "forbid",
        from: "",
        to: "",
        enabled: true,
      },
    ]);
  });

  const suggest = document.createElement("button");
  suggest.type = "button";
  suggest.className = "btn btn-ghost";
  suggest.textContent = t("designRules.suggestLayers");
  suggest.title = t("designRules.suggestLayersTitle");
  suggest.addEventListener("click", () => handlers.onSuggestLayers?.());

  actions.append(addLayers, addForbid, suggest);
  container.appendChild(actions);

  if (rules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = t("designRules.empty");
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "design-rules-list";

  for (const rule of rules) {
    const card = document.createElement("div");
    card.className = "design-rule-card";

    const header = document.createElement("div");
    header.className = "design-rule-header";

    const enable = document.createElement("input");
    enable.type = "checkbox";
    enable.checked = rule.enabled;
    enable.title = t("designRules.enabled");
    enable.addEventListener("change", () => {
      handlers.onChange(
        rules.map((r) =>
          r.id === rule.id ? { ...r, enabled: enable.checked } : r,
        ),
      );
    });

    const kind = document.createElement("span");
    kind.className = "design-rule-kind";
    kind.textContent =
      rule.kind === "layers"
        ? t("designRules.kindLayers")
        : t("designRules.kindForbid");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-ghost btn-icon";
    remove.textContent = "×";
    remove.title = t("designRules.remove");
    remove.addEventListener("click", () => {
      handlers.onChange(rules.filter((r) => r.id !== rule.id));
    });

    header.append(enable, kind, remove);
    card.appendChild(header);

    if (rule.kind === "layers") {
      const label = document.createElement("label");
      label.className = "design-rule-field";
      const layersSpan = document.createElement("span");
      layersSpan.textContent = t("designRules.layersLabel");
      label.appendChild(layersSpan);
      const ta = document.createElement("textarea");
      ta.rows = Math.min(8, Math.max(3, rule.layers.length + 1));
      ta.value = rule.layers.join("\n");
      ta.addEventListener("change", () => {
        const layers = ta.value
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        handlers.onChange(
          rules.map((r) =>
            r.id === rule.id && r.kind === "layers" ? { ...r, layers } : r,
          ),
        );
      });
      label.appendChild(ta);
      card.appendChild(label);
    } else {
      const fromField = document.createElement("label");
      fromField.className = "design-rule-field";
      const fromSpan = document.createElement("span");
      fromSpan.textContent = t("designRules.fromLabel");
      fromField.appendChild(fromSpan);
      const fromInput = document.createElement("input");
      fromInput.type = "text";
      fromInput.value = rule.from;
      fromInput.placeholder = t("designRules.fromPlaceholder");
      fromInput.addEventListener("change", () => {
        handlers.onChange(
          rules.map((r) =>
            r.id === rule.id && r.kind === "forbid"
              ? { ...r, from: fromInput.value.trim() }
              : r,
          ),
        );
      });
      fromField.appendChild(fromInput);

      const toField = document.createElement("label");
      toField.className = "design-rule-field";
      const toSpan = document.createElement("span");
      toSpan.textContent = t("designRules.toLabel");
      toField.appendChild(toSpan);
      const toInput = document.createElement("input");
      toInput.type = "text";
      toInput.value = rule.to;
      toInput.placeholder = t("designRules.toPlaceholder");
      toInput.addEventListener("change", () => {
        handlers.onChange(
          rules.map((r) =>
            r.id === rule.id && r.kind === "forbid"
              ? { ...r, to: toInput.value.trim() }
              : r,
          ),
        );
      });
      toField.appendChild(toInput);

      card.append(fromField, toField);
    }

    list.appendChild(card);
  }

  container.appendChild(list);
}
