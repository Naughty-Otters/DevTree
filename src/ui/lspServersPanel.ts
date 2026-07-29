import type {
  LspServerStatus,
  LspSettingDef,
  LspSettingsMap,
} from "../lsp/types";
import { lucideIcon } from "./icons";
import { ChevronDown } from "lucide";

export interface LspServersPanelState {
  servers: LspServerStatus[];
  settings: LspSettingsMap;
  expandedServerId: string | null;
  installingId: string | null;
  errors: Record<string, string>;
  loading: boolean;
}

export function createLspServersPanel(
  container: HTMLElement,
  state: LspServersPanelState,
  handlers: {
    onRefresh: () => void | Promise<void>;
    onInstall: (id: string) => void | Promise<void>;
    onSettingsChange: (settings: LspSettingsMap) => void;
  },
): void {
  if (state.expandedServerId === undefined) {
    state.expandedServerId = null;
  }
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "lsp-header";

  const note = document.createElement("span");
  note.className = "lsp-note";
  note.textContent = "Optional — analysis falls back to heuristics if missing";

  const refresh = document.createElement("button");
  refresh.className = "btn-text";
  refresh.textContent = "Refresh";
  refresh.disabled = state.loading || state.installingId != null;
  refresh.addEventListener("click", () => {
    void handlers.onRefresh();
  });

  header.append(note, refresh);
  container.appendChild(header);

  const list = document.createElement("div");
  list.className = "lsp-list";

  if (state.loading && state.servers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lsp-empty";
    empty.textContent = "Checking language servers…";
    list.appendChild(empty);
  } else if (state.servers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lsp-empty";
    empty.textContent = "Click Refresh to check installed language servers";
    list.appendChild(empty);
  } else {
    for (const server of state.servers) {
      list.appendChild(serverRow(server, state, handlers, container));
    }
  }

  container.appendChild(list);
}

function serverRow(
  server: LspServerStatus,
  state: LspServersPanelState,
  handlers: {
    onRefresh: () => void | Promise<void>;
    onInstall: (id: string) => void | Promise<void>;
    onSettingsChange: (settings: LspSettingsMap) => void;
  },
  container: HTMLElement,
): HTMLElement {
  const settingsDefs = server.settings ?? [];
  const expanded = state.expandedServerId === server.id;
  const enabled = Boolean(state.settings[server.id]?.enabled ?? true);

  const row = document.createElement("div");
  row.className = `lsp-server-row${expanded ? " is-expanded" : ""}${
    enabled ? "" : " lsp-server-disabled"
  }`;

  const top = document.createElement("div");
  top.className = "lsp-server-top";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "lsp-server-toggle";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");

  const info = document.createElement("div");
  info.className = "lsp-server-info";

  const name = document.createElement("div");
  name.className = "lsp-server-name";
  name.textContent = server.label;

  const meta = document.createElement("div");
  meta.className = "lsp-server-meta";
  if (server.status === "installed" && server.command) {
    meta.textContent = server.command;
    meta.title = server.command;
  } else {
    meta.textContent = server.installHint;
    meta.title = server.installHint;
  }

  info.append(name, meta);

  const chevron = document.createElement("span");
  chevron.className = "lsp-server-chevron";
  chevron.setAttribute("aria-hidden", "true");
  if (settingsDefs.length > 0) {
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
    if (settingsDefs.length === 0) return;
    state.expandedServerId =
      state.expandedServerId === server.id ? null : server.id;
    createLspServersPanel(container, state, handlers);
  });

  const badge = document.createElement("span");
  badge.className =
    server.status === "installed"
      ? "lsp-status lsp-status-installed"
      : "lsp-status lsp-status-missing";
  badge.textContent =
    server.status === "installed" ? "Installed" : "Missing";

  top.append(toggle, badge);
  row.appendChild(top);

  const actions = document.createElement("div");
  actions.className = "lsp-server-actions";

  if (server.status === "missing") {
    const install = document.createElement("button");
    install.className = "btn btn-ghost lsp-install-btn";
    const busy = state.installingId === server.id;
    install.disabled = state.installingId != null || state.loading;
    install.textContent = busy ? "Installing…" : "Install";
    install.addEventListener("click", () => {
      void handlers.onInstall(server.id);
    });
    actions.appendChild(install);
  }

  row.appendChild(actions);

  if (settingsDefs.length > 0 && expanded) {
    const settingsEl = document.createElement("div");
    settingsEl.className = "lsp-server-settings";
    for (const def of settingsDefs) {
      settingsEl.appendChild(
        settingControl(server.id, def, state, handlers, container),
      );
    }
    row.appendChild(settingsEl);
  }

  const err = state.errors[server.id];
  if (err) {
    const errEl = document.createElement("div");
    errEl.className = "lsp-server-error";
    errEl.textContent = err;
    row.appendChild(errEl);
  }

  return row;
}

function settingControl(
  serverId: string,
  def: LspSettingDef,
  state: LspServersPanelState,
  handlers: {
    onRefresh: () => void | Promise<void>;
    onInstall: (id: string) => void | Promise<void>;
    onSettingsChange: (settings: LspSettingsMap) => void;
  },
  container: HTMLElement,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "lsp-setting";

  const label = document.createElement("label");
  label.className = "lsp-setting-label";
  label.textContent = def.label;

  const current = state.settings[serverId]?.[def.key] ?? def.default;

  if (def.kind === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "lsp-setting-input";
    input.checked = Boolean(current);
    input.addEventListener("change", () => {
      if (!state.settings[serverId]) state.settings[serverId] = {};
      state.settings[serverId][def.key] = input.checked;
      handlers.onSettingsChange({ ...state.settings });
      if (def.key === "enabled") {
        createLspServersPanel(container, state, handlers);
      }
    });
    row.append(label, input);
  } else {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "lsp-setting-input lsp-setting-number";
    input.value = String(current);
    if (def.min != null) input.min = String(def.min);
    if (def.max != null) input.max = String(def.max);
    input.addEventListener("change", () => {
      let n = Number(input.value);
      if (!Number.isFinite(n)) n = Number(def.default) || 0;
      if (def.min != null) n = Math.max(def.min, n);
      if (def.max != null) n = Math.min(def.max, n);
      input.value = String(n);
      if (!state.settings[serverId]) state.settings[serverId] = {};
      state.settings[serverId][def.key] = n;
      handlers.onSettingsChange({ ...state.settings });
    });
    row.append(label, input);
  }

  return row;
}
