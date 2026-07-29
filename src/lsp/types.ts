export type LspServerInstallStatus = "installed" | "missing";

export interface LspSettingDef {
  key: string;
  label: string;
  kind: "number" | "boolean";
  default: number | boolean;
  min?: number;
  max?: number;
}

export interface LspServerStatus {
  id: string;
  language: string;
  label: string;
  status: LspServerInstallStatus;
  command?: string;
  installHint: string;
  settings?: LspSettingDef[];
}

export interface LspInstallResult {
  ok: boolean;
  message: string;
  server: LspServerStatus;
}

/** Per-LSP setting values, keyed by server id then setting key. */
export type LspSettingsMap = Record<string, Record<string, number | boolean>>;

export function defaultLspSettings(servers: LspServerStatus[]): LspSettingsMap {
  const out: LspSettingsMap = {};
  for (const server of servers) {
    const vals: Record<string, number | boolean> = {};
    for (const s of server.settings ?? []) {
      vals[s.key] = s.default;
    }
    if (Object.keys(vals).length > 0) {
      out[server.id] = vals;
    }
  }
  return out;
}

export function mergeLspSettings(
  servers: LspServerStatus[],
  saved: LspSettingsMap | undefined | null,
): LspSettingsMap {
  const defaults = defaultLspSettings(servers);
  if (!saved) return defaults;
  const out: LspSettingsMap = { ...defaults };
  for (const [id, vals] of Object.entries(saved)) {
    out[id] = { ...(out[id] ?? {}), ...vals };
  }
  return out;
}
