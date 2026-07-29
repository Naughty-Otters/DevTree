export type LspServerInstallStatus = "installed" | "missing";

export interface LspServerStatus {
  id: string;
  language: string;
  label: string;
  status: LspServerInstallStatus;
  command?: string;
  installHint: string;
}

export interface LspInstallResult {
  ok: boolean;
  message: string;
  server: LspServerStatus;
}
