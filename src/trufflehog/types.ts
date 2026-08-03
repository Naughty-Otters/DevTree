export type TrufflehogInstallStatus = "installed" | "missing";

export interface TrufflehogStatus {
  status: TrufflehogInstallStatus;
  command?: string;
  installHint: string;
}

export interface TrufflehogInstallResult {
  ok: boolean;
  message: string;
  status: TrufflehogStatus;
}

export function isTrufflehogMissingMessage(message: string): boolean {
  return (
    message.toLowerCase().includes("trufflehog") &&
    message.toLowerCase().includes("not installed")
  );
}
