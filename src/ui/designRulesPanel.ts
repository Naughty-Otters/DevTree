import type { DesignRule } from "../analysis/designRules";
import { newRuleId } from "../analysis/designRules";
import { t } from "../i18n";

export interface DesignRulesChangeMeta {
  /** Rebuild the panel DOM (add/remove rules or layer rows). Omit for field edits. */
  refreshPanel?: boolean;
}

export interface DesignRulesPanelHandlers {
  onChange: (rules: DesignRule[], meta?: DesignRulesChangeMeta) => void;
  onSuggestLayers?: () => void;
  packageIds?: string[];
}

let closeOpenPackageMenu: (() => void) | null = null;

function closePackageMenu(): void {
  if (closeOpenPackageMenu) {
    closeOpenPackageMenu();
    closeOpenPackageMenu = null;
  }
}

function debounceInput(
  el: HTMLInputElement,
  ms: number,
  fn: () => void,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  el.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  });
}

function createHelpBlock(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "design-rules-help";
  p.textContent = text;
  return p;
}

function createActionRow(
  label: string,
  hint: string,
  onClick: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "design-rules-action-row";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn design-rules-action-btn";
  btn.textContent = label;
  btn.addEventListener("click", onClick);

  const desc = document.createElement("span");
  desc.className = "design-rules-action-hint";
  desc.textContent = hint;

  row.append(btn, desc);
  return row;
}

function disableAutocomplete(input: HTMLInputElement): void {
  input.autocomplete = "off";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("data-1p-ignore", "true");
  input.setAttribute("data-form-type", "other");
}

function createPackageMenuPicker(
  packages: string[],
  value: string,
  placeholder: string,
  onValue: (v: string) => void,
  allowCustom: boolean,
): HTMLElement {
  if (packages.length === 0) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "design-rule-package-input";
    input.value = value;
    input.placeholder = placeholder;
    disableAutocomplete(input);
    debounceInput(input, 400, () => onValue(input.value.trim()));
    return input;
  }

  const wrap = document.createElement("div");
  wrap.className = "design-rule-package-picker";

  const isCustom =
    allowCustom && value.length > 0 && !packages.includes(value);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "design-rule-package-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");

  const menu = document.createElement("div");
  menu.className = "design-rule-package-menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");

  const searchWrap = document.createElement("div");
  searchWrap.className = "design-rule-package-menu-search";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "design-rule-package-menu-filter";
  search.placeholder = t("designRules.searchPackages");
  disableAutocomplete(search);
  searchWrap.appendChild(search);

  const list = document.createElement("div");
  list.className = "design-rule-package-menu-list";

  const updateTrigger = (text: string, asPlaceholder = false) => {
    trigger.textContent = text || placeholder;
    trigger.classList.toggle("is-placeholder", asPlaceholder || !text);
  };

  updateTrigger(isCustom ? value : value, !value);

  const renderOptions = (filter: string) => {
    list.replaceChildren();
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? packages.filter((p) => p.toLowerCase().includes(q))
      : packages;

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "design-rule-package-menu-empty";
      empty.textContent = t("designRules.noPackageMatch");
      list.appendChild(empty);
    } else {
      for (const pkg of filtered) {
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "design-rule-package-option";
        opt.setAttribute("role", "option");
        if (pkg === value) opt.classList.add("is-selected");
        opt.textContent = pkg;
        opt.addEventListener("click", () => {
          onValue(pkg);
          updateTrigger(pkg);
          hideMenu();
          if (customInput) customInput.hidden = true;
        });
        list.appendChild(opt);
      }
    }

    if (allowCustom) {
      const customBtn = document.createElement("button");
      customBtn.type = "button";
      customBtn.className =
        "design-rule-package-option design-rule-package-option-custom";
      customBtn.setAttribute("role", "option");
      customBtn.textContent = t("designRules.customPrefix");
      customBtn.addEventListener("click", () => {
        hideMenu();
        if (customInput) {
          customInput.hidden = false;
          customInput.focus();
        }
        updateTrigger(t("designRules.customPrefix"), true);
      });
      list.appendChild(customBtn);
    }
  };

  renderOptions("");
  search.addEventListener("input", () => renderOptions(search.value));

  menu.append(searchWrap, list);

  let dismissController: AbortController | null = null;

  const hideMenu = () => {
    menu.hidden = true;
    if (menu.parentElement === document.body) {
      document.body.removeChild(menu);
    }
    if (dismissController) {
      dismissController.abort();
      dismissController = null;
    }
    if (closeOpenPackageMenu === hideMenu) {
      closeOpenPackageMenu = null;
    }
  };

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 220);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    menu.style.position = "fixed";
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.width = `${width}px`;
    menu.style.zIndex = "20000";
  };

  const showMenu = () => {
    closePackageMenu();
    positionMenu();
    document.body.appendChild(menu);
    menu.hidden = false;
    search.value = "";
    renderOptions("");
    closeOpenPackageMenu = hideMenu;

    dismissController = new AbortController();
    const { signal } = dismissController;
    document.addEventListener(
      "mousedown",
      (e) => {
        const target = e.target as Node;
        if (!menu.contains(target) && !trigger.contains(target)) {
          hideMenu();
        }
      },
      { signal },
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") hideMenu();
      },
      { signal },
    );
    window.addEventListener(
      "resize",
      () => {
        if (!menu.hidden) positionMenu();
      },
      { signal },
    );

    requestAnimationFrame(() => search.focus());
  };

  trigger.addEventListener("click", () => {
    if (menu.hidden || menu.parentElement !== document.body) {
      showMenu();
    } else {
      hideMenu();
    }
  });

  let customInput: HTMLInputElement | null = null;
  if (allowCustom) {
    customInput = document.createElement("input");
    customInput.type = "text";
    customInput.className =
      "design-rule-package-input design-rule-package-custom";
    customInput.placeholder = placeholder;
    customInput.value = isCustom ? value : "";
    customInput.hidden = !isCustom;
    disableAutocomplete(customInput);
    debounceInput(customInput, 400, () => onValue(customInput!.value.trim()));
    wrap.appendChild(customInput);
  }

  wrap.appendChild(trigger);
  return wrap;
}

function normalizeLayers(layers: string[]): string[] {
  return layers.map((s) => s.trim()).filter(Boolean);
}

export function createDesignRulesPanel(
  container: HTMLElement,
  rules: DesignRule[],
  handlers: DesignRulesPanelHandlers,
): void {
  container.replaceChildren();
  container.classList.add("design-rules-panel");

  const pkgs = handlers.packageIds ?? [];

  const commit = (next: DesignRule[], refreshPanel = false) => {
    handlers.onChange(
      next,
      refreshPanel ? { refreshPanel: true } : undefined,
    );
  };

  const intro = document.createElement("p");
  intro.className = "design-rules-intro";
  intro.textContent = t("designRules.intro");
  container.appendChild(intro);

  container.appendChild(createHelpBlock(t("designRules.reportNote")));

  if (pkgs.length > 0) {
    container.appendChild(
      createHelpBlock(t("designRules.packagesHint", { n: pkgs.length })),
    );
  } else {
    container.appendChild(createHelpBlock(t("designRules.packagesHintNoAnalysis")));
  }

  const actions = document.createElement("div");
  actions.className = "design-rules-actions";

  const actionsTitle = document.createElement("div");
  actionsTitle.className = "design-rules-actions-title";
  actionsTitle.textContent = t("designRules.actionsTitle");
  actions.appendChild(actionsTitle);

  actions.appendChild(
    createActionRow(
      t("designRules.addLayerStack"),
      t("designRules.addLayerStackHint"),
      () => {
        commit(
          [
            ...rules,
            {
              id: newRuleId(),
              kind: "layers",
              layers: [""],
              enabled: true,
            },
          ],
          true,
        );
      },
    ),
  );

  actions.appendChild(
    createActionRow(
      t("designRules.addForbidRule"),
      t("designRules.addForbidRuleHint"),
      () => {
        commit(
          [
            ...rules,
            {
              id: newRuleId(),
              kind: "forbid",
              from: "",
              to: "",
              enabled: true,
            },
          ],
          true,
        );
      },
    ),
  );

  if (handlers.onSuggestLayers) {
    actions.appendChild(
      createActionRow(
        t("designRules.suggestLayers"),
        t("designRules.suggestLayersHint"),
        () => handlers.onSuggestLayers?.(),
      ),
    );
  }

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
      commit(
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
      commit(rules.filter((r) => r.id !== rule.id), true);
    });

    header.append(enable, kind, remove);
    card.appendChild(header);

    if (rule.kind === "layers") {
      card.appendChild(createHelpBlock(t("designRules.layersHelp")));

      const layersField = document.createElement("div");
      layersField.className = "design-rule-field";

      const layersLabel = document.createElement("span");
      layersLabel.textContent = t("designRules.layersLabel");
      layersField.appendChild(layersLabel);

      const layerList = document.createElement("div");
      layerList.className = "design-rule-layer-list";

      const rowValues =
        rule.layers.length > 0 ? [...rule.layers] : [""];

      const updateLayerAt = (index: number, value: string) => {
        const nextRows = [...rowValues];
        nextRows[index] = value;
        commit(
          rules.map((r) =>
            r.id === rule.id && r.kind === "layers"
              ? { ...r, layers: normalizeLayers(nextRows) }
              : r,
          ),
        );
      };

      for (let i = 0; i < rowValues.length; i++) {
        const row = document.createElement("div");
        row.className = "design-rule-layer-row";

        const indexLabel = document.createElement("span");
        indexLabel.className = "design-rule-layer-index";
        indexLabel.textContent =
          i === 0
            ? t("designRules.layerBottom")
            : i === rowValues.length - 1 && rowValues.length > 1
              ? t("designRules.layerTop")
              : `${i + 1}`;

        const picker = createPackageMenuPicker(
          pkgs,
          rowValues[i] ?? "",
          t("designRules.selectPackage"),
          (value) => updateLayerAt(i, value),
          false,
        );

        const removeRow = document.createElement("button");
        removeRow.type = "button";
        removeRow.className = "btn btn-ghost btn-icon";
        removeRow.textContent = "×";
        removeRow.title = t("designRules.removeLayerRow");
        removeRow.addEventListener("click", () => {
          const nextRows = rowValues.filter((_, j) => j !== i);
          commit(
            rules.map((r) =>
              r.id === rule.id && r.kind === "layers"
                ? {
                    ...r,
                    layers:
                      nextRows.length > 0
                        ? normalizeLayers(nextRows)
                        : [],
                  }
                : r,
            ),
            true,
          );
        });

        row.append(indexLabel, picker, removeRow);
        layerList.appendChild(row);
      }

      const addRow = document.createElement("button");
      addRow.type = "button";
      addRow.className = "btn btn-ghost design-rule-add-layer";
      addRow.textContent = t("designRules.addLayerRow");
      addRow.addEventListener("click", () => {
        const base =
          rule.layers.length > 0 ? [...rule.layers] : normalizeLayers(rowValues);
        commit(
          rules.map((r) =>
            r.id === rule.id && r.kind === "layers"
              ? { ...r, layers: [...base, ""] }
              : r,
          ),
          true,
        );
      });

      layersField.append(layerList, addRow);
      card.appendChild(layersField);
    } else {
      card.appendChild(createHelpBlock(t("designRules.forbidHelp")));

      const fromField = document.createElement("label");
      fromField.className = "design-rule-field";
      const fromSpan = document.createElement("span");
      fromSpan.textContent = t("designRules.fromLabel");
      fromField.appendChild(fromSpan);
      fromField.appendChild(
        createPackageMenuPicker(
          pkgs,
          rule.from,
          t("designRules.selectPackage"),
          (value) => {
            commit(
              rules.map((r) =>
                r.id === rule.id && r.kind === "forbid"
                  ? { ...r, from: value }
                  : r,
              ),
            );
          },
          true,
        ),
      );

      const toField = document.createElement("label");
      toField.className = "design-rule-field";
      const toSpan = document.createElement("span");
      toSpan.textContent = t("designRules.toLabel");
      toField.appendChild(toSpan);
      toField.appendChild(
        createPackageMenuPicker(
          pkgs,
          rule.to,
          t("designRules.selectPackage"),
          (value) => {
            commit(
              rules.map((r) =>
                r.id === rule.id && r.kind === "forbid"
                  ? { ...r, to: value }
                  : r,
              ),
            );
          },
          true,
        ),
      );

      card.append(fromField, toField);
    }

    list.appendChild(card);
  }

  container.appendChild(list);
}
