export type GitleaksInstallStatus = "installed" | "missing";

export interface GitleaksStatus {
  status: GitleaksInstallStatus;
  command?: string;
  installHint: string;
}

export interface GitleaksInstallResult {
  ok: boolean;
  message: string;
  status: GitleaksStatus;
}

export function isGitleaksMissingMessage(message: string): boolean {
  return message.toLowerCase().includes("not installed");
}
