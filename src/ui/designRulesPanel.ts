import type { DesignRule } from "../analysis/designRules";
import { newRuleId } from "../analysis/designRules";

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
  intro.textContent =
    "LDM design rules capture intended architecture. Layers are ordered bottom→top; higher layers may depend on lower ones. Forbid rules block specific dependency directions.";
  container.appendChild(intro);

  const actions = document.createElement("div");
  actions.className = "design-rules-actions";

  const addLayers = document.createElement("button");
  addLayers.type = "button";
  addLayers.className = "btn btn-ghost";
  addLayers.textContent = "Add layer stack";
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
  addForbid.textContent = "Add forbid rule";
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
  suggest.textContent = "Suggest layers from DSM";
  suggest.title = "Use current partitioned DSM order (foundations → dependents)";
  suggest.addEventListener("click", () => handlers.onSuggestLayers?.());

  actions.append(addLayers, addForbid, suggest);
  container.appendChild(actions);

  if (rules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "No design rules — architecture conformance is skipped";
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
    enable.title = "Enabled";
    enable.addEventListener("change", () => {
      handlers.onChange(
        rules.map((r) =>
          r.id === rule.id ? { ...r, enabled: enable.checked } : r,
        ),
      );
    });

    const kind = document.createElement("span");
    kind.className = "design-rule-kind";
    kind.textContent = rule.kind === "layers" ? "Layers" : "Forbid";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-ghost btn-icon";
    remove.textContent = "×";
    remove.title = "Remove rule";
    remove.addEventListener("click", () => {
      handlers.onChange(rules.filter((r) => r.id !== rule.id));
    });

    header.append(enable, kind, remove);
    card.appendChild(header);

    if (rule.kind === "layers") {
      const label = document.createElement("label");
      label.className = "design-rule-field";
      label.innerHTML = `<span>Layers (bottom → top, one package per line)</span>`;
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
      fromField.innerHTML = `<span>From (package / path prefix)</span>`;
      const fromInput = document.createElement("input");
      fromInput.type = "text";
      fromInput.value = rule.from;
      fromInput.placeholder = "e.g. ui";
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
      toField.innerHTML = `<span>To (package / path prefix)</span>`;
      const toInput = document.createElement("input");
      toInput.type = "text";
      toInput.value = rule.to;
      toInput.placeholder = "e.g. core";
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
