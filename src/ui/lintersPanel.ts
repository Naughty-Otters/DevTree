import type {
  LanguageLinterGroup,
  LinterSettingsMap,
} from "../linter/types";
import { selectedLinterForGroup } from "../linter/types";
import { t } from "../i18n";
import { lucideIcon } from "./icons";
import { createLoadingPlaceholder } from "./loadingPlaceholder";
import { ChevronDown } from "lucide";

export interface LintersPanelState {
  groups: LanguageLinterGroup[];
  settings: LinterSettingsMap;
  expandedLanguageId: string | null;
  installingKey: string | null;
  errors: Record<string, string>;
  loading: boolean;
}

function installKey(languageId: string, linterId: string): string {
  return `${languageId}:${linterId}`;
}

export function createLintersPanel(
  container: HTMLElement,
  state: LintersPanelState,
  handlers: {
    onRefresh: () => void | Promise<void>;
    onInstall: (languageId: string, linterId: string) => void | Promise<void>;
    onSettingsChange: (settings: LinterSettingsMap) => void;
  },
): void {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "linter-header";

  const note = document.createElement("span");
  note.className = "linter-note";
  note.textContent = t("linters.note");

  const refresh = document.createElement("button");
  refresh.className = "btn-text";
  refresh.textContent = t("linters.refresh");
  refresh.disabled = state.loading || state.installingKey != null;
  refresh.addEventListener("click", () => {
    void handlers.onRefresh();
  });

  header.append(note, refresh);
  container.appendChild(header);

  const list = document.createElement("div");
  list.className = "linter-list";

  if (state.loading && state.groups.length === 0) {
    list.appendChild(
      createLoadingPlaceholder({
        title: t("linters.checking"),
        size: "panel",
      }),
    );
  } else if (state.groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "linter-empty";
    empty.textContent = t("linters.empty");
    list.appendChild(empty);
  } else {
    for (const group of state.groups) {
      list.appendChild(languageRow(group, state, handlers, container));
    }
  }

  container.appendChild(list);
}

function languageRow(
  group: LanguageLinterGroup,
  state: LintersPanelState,
  handlers: {
    onRefresh: () => void | Promise<void>;
    onInstall: (languageId: string, linterId: string) => void | Promise<void>;
    onSettingsChange: (settings: LinterSettingsMap) => void;
  },
  container: HTMLElement,
): HTMLElement {
  const expanded = state.expandedLanguageId === group.id;
  const enabled = Boolean(state.settings[group.id]?.enabled ?? true);
  const selected = selectedLinterForGroup(group, state.settings);
  const selectedId =
    (state.settings[group.id]?.linter_id as string | undefined) ??
    group.defaultLinterId;

  const row = document.createElement("div");
  row.className = `linter-lang-row${expanded ? " is-expanded" : ""}${
    enabled ? "" : " linter-lang-disabled"
  }`;

  const top = document.createElement("div");
  top.className = "linter-lang-top";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "linter-lang-enabled";
  checkbox.checked = enabled;
  checkbox.title = enabled
    ? t("linters.disableLanguage")
    : t("linters.enableLanguage");
  checkbox.addEventListener("change", () => {
    if (!state.settings[group.id]) state.settings[group.id] = {};
    state.settings[group.id].enabled = checkbox.checked;
    handlers.onSettingsChange({ ...state.settings });
    createLintersPanel(container, state, handlers);
  });

  const info = document.createElement("button");
  info.type = "button";
  info.className = "linter-lang-info";
  info.title = enabled
    ? t("linters.disableLanguage")
    : t("linters.enableLanguage");

  const name = document.createElement("div");
  name.className = "linter-lang-name";
  name.textContent = group.label;

  const meta = document.createElement("div");
  meta.className = "linter-lang-meta";
  const level =
    (state.settings[group.id]?.min_level as string | undefined) ??
    group.defaultLevel;
  if (selected?.status === "installed") {
    meta.textContent = t("linters.metaInstalled", {
      label: selected.label,
      level,
    });
  } else if (selected) {
    meta.textContent = t("linters.metaNotInstalled", { label: selected.label });
  } else {
    meta.textContent = group.linters.find((l) => l.isDefault)?.installHint ?? "";
  }

  info.append(name, meta);
  info.addEventListener("click", () => {
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event("change"));
  });

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "linter-lang-expand";
  expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  expandBtn.title = expanded
    ? t("linters.collapseSettings")
    : t("linters.expandSettings");
  expandBtn.setAttribute(
    "aria-label",
    t("linters.expandSettingsAria", { name: group.label }),
  );

  const chevron = document.createElement("span");
  chevron.className = "linter-lang-chevron";
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
    state.expandedLanguageId =
      state.expandedLanguageId === group.id ? null : group.id;
    createLintersPanel(container, state, handlers);
  });

  const badge = document.createElement("span");
  badge.className =
    selected?.status === "installed"
      ? "linter-status linter-status-installed"
      : "linter-status linter-status-missing";
  badge.textContent =
    selected?.status === "installed"
      ? t("linters.ready")
      : t("linters.missing");

  top.append(checkbox, info, expandBtn, badge);
  row.appendChild(top);

  if (expanded) {
    const settingsEl = document.createElement("div");
    settingsEl.className = "linter-lang-settings";

    settingsEl.appendChild(
      linterSelect(group, state, handlers, container),
    );

    settingsEl.appendChild(
      levelSelect(group, state, handlers, container),
    );

    settingsEl.appendChild(
      numberSetting(
        group.id,
        "sample_limit",
        t("linters.sampleLimit"),
        1,
        100,
        state,
        handlers,
      ),
    );

    const available = document.createElement("div");
    available.className = "linter-available";
    const availLabel = document.createElement("div");
    availLabel.className = "linter-available-label";
    availLabel.textContent = t("linters.available");
    available.appendChild(availLabel);

    for (const linter of group.linters) {
      const item = document.createElement("div");
      item.className = "linter-available-item";

      const label = document.createElement("span");
      label.className = "linter-available-name";
      label.textContent = linter.isDefault
        ? t("linters.defaultSuffix", { label: linter.label })
        : linter.label;

      const status = document.createElement("span");
      status.className =
        linter.status === "installed"
          ? "linter-status linter-status-installed"
          : "linter-status linter-status-missing";
      status.textContent =
        linter.status === "installed"
          ? t("linters.installed")
          : t("linters.missing");

      item.append(label, status);

      if (linter.status === "missing") {
        const install = document.createElement("button");
        install.className = "btn btn-ghost linter-install-btn";
        const key = installKey(group.id, linter.id);
        const busy = state.installingKey === key;
        install.disabled = state.installingKey != null || state.loading;
        install.textContent = busy
          ? t("linters.installing")
          : t("linters.install");
        install.addEventListener("click", () => {
          void handlers.onInstall(group.id, linter.id);
        });
        item.appendChild(install);
      } else if (linter.id !== selectedId) {
        const use = document.createElement("button");
        use.className = "btn btn-ghost linter-use-btn";
        use.textContent = t("linters.use");
        use.addEventListener("click", () => {
          if (!state.settings[group.id]) state.settings[group.id] = {};
          state.settings[group.id].linter_id = linter.id;
          handlers.onSettingsChange({ ...state.settings });
          createLintersPanel(container, state, handlers);
        });
        item.appendChild(use);
      }

      available.appendChild(item);
    }

    settingsEl.appendChild(available);
    row.appendChild(settingsEl);
  }

  const err = state.errors[installKey(group.id, selectedId)];
  if (err) {
    const errEl = document.createElement("div");
    errEl.className = "linter-lang-error";
    errEl.textContent = err;
    row.appendChild(errEl);
  }

  return row;
}

function linterSelect(
  group: LanguageLinterGroup,
  state: LintersPanelState,
  handlers: { onSettingsChange: (settings: LinterSettingsMap) => void },
  container: HTMLElement,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "linter-setting";

  const label = document.createElement("label");
  label.className = "linter-setting-label";
  label.textContent = t("linters.linter");

  const select = document.createElement("select");
  select.className = "linter-setting-select";
  const current =
    (state.settings[group.id]?.linter_id as string | undefined) ??
    group.defaultLinterId;

  for (const linter of group.linters) {
    const opt = document.createElement("option");
    opt.value = linter.id;
    opt.textContent =
      linter.status === "installed"
        ? linter.label
        : t("linters.notInstalledOption", { label: linter.label });
    opt.selected = linter.id === current;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => {
    if (!state.settings[group.id]) state.settings[group.id] = {};
    state.settings[group.id].linter_id = select.value;
    handlers.onSettingsChange({ ...state.settings });
    createLintersPanel(container, state, handlers as never);
  });

  row.append(label, select);
  return row;
}

function levelSelect(
  group: LanguageLinterGroup,
  state: LintersPanelState,
  handlers: { onSettingsChange: (settings: LinterSettingsMap) => void },
  container: HTMLElement,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "linter-setting";

  const label = document.createElement("label");
  label.className = "linter-setting-label";
  label.textContent = t("linters.minLevel");

  const select = document.createElement("select");
  select.className = "linter-setting-select";
  const current =
    (state.settings[group.id]?.min_level as string | undefined) ??
    group.defaultLevel;

  for (const level of group.levels) {
    const opt = document.createElement("option");
    opt.value = level.id;
    opt.textContent = level.label;
    opt.selected = level.id === current;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => {
    if (!state.settings[group.id]) state.settings[group.id] = {};
    state.settings[group.id].min_level = select.value;
    handlers.onSettingsChange({ ...state.settings });
    createLintersPanel(container, state, handlers as never);
  });

  row.append(label, select);
  return row;
}

function numberSetting(
  languageId: string,
  key: string,
  text: string,
  min: number,
  max: number,
  state: LintersPanelState,
  handlers: { onSettingsChange: (settings: LinterSettingsMap) => void },
): HTMLElement {
  const row = document.createElement("div");
  row.className = "linter-setting";

  const label = document.createElement("label");
  label.className = "linter-setting-label";
  label.textContent = text;

  const input = document.createElement("input");
  input.type = "number";
  input.className = "linter-setting-input linter-setting-number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(state.settings[languageId]?.[key] ?? 20);
  input.addEventListener("change", () => {
    let n = Number(input.value);
    if (!Number.isFinite(n)) n = 20;
    n = Math.max(min, Math.min(max, n));
    input.value = String(n);
    if (!state.settings[languageId]) state.settings[languageId] = {};
    state.settings[languageId][key] = n;
    handlers.onSettingsChange({ ...state.settings });
  });

  row.append(label, input);
  return row;
}
