import type { LspServerStatus } from "../lsp/types";

export interface LspServersPanelState {
  servers: LspServerStatus[];
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
  },
): void {
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
  } else {
    for (const server of state.servers) {
      list.appendChild(serverRow(server, state, handlers));
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
  },
): HTMLElement {
  const row = document.createElement("div");
  row.className = "lsp-server-row";

  const top = document.createElement("div");
  top.className = "lsp-server-top";

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

  const badge = document.createElement("span");
  badge.className =
    server.status === "installed"
      ? "lsp-status lsp-status-installed"
      : "lsp-status lsp-status-missing";
  badge.textContent =
    server.status === "installed" ? "Installed" : "Missing";

  top.append(info, badge);
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

  const err = state.errors[server.id];
  if (err) {
    const errEl = document.createElement("div");
    errEl.className = "lsp-server-error";
    errEl.textContent = err;
    row.appendChild(errEl);
  }

  return row;
}
