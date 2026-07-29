export type LinterInstallStatus = "installed" | "missing";

export interface LinterLevelDef {
  id: string;
  label: string;
}

export interface LinterOption {
  id: string;
  label: string;
  status: LinterInstallStatus;
  command?: string;
  installHint: string;
  isDefault: boolean;
}

export interface LanguageLinterGroup {
  id: string;
  language: string;
  label: string;
  linters: LinterOption[];
  levels: LinterLevelDef[];
  defaultLinterId: string;
  defaultLevel: string;
}

export interface LinterInstallResult {
  ok: boolean;
  message: string;
  linter: LinterOption;
  languageId: string;
}

/** Per-language linter settings, keyed by language id (typescript, rust, …). */
export type LinterSettingsMap = Record<
  string,
  Record<string, string | number | boolean>
>;

export const FALLBACK_LINTER_DEFAULTS: LinterSettingsMap = {
  typescript: {
    enabled: true,
    linter_id: "eslint",
    min_level: "warning",
    sample_limit: 20,
  },
  rust: {
    enabled: true,
    linter_id: "clippy",
    min_level: "warning",
    sample_limit: 20,
  },
  python: {
    enabled: true,
    linter_id: "ruff",
    min_level: "warning",
    sample_limit: 20,
  },
  go: {
    enabled: true,
    linter_id: "golangci-lint",
    min_level: "warning",
    sample_limit: 20,
  },
};

/** Defaults for all languages, with optional API groups and saved overrides. */
export function ensureLinterSettings(
  saved: LinterSettingsMap | undefined | null,
  groups?: LanguageLinterGroup[],
): LinterSettingsMap {
  if (groups && groups.length > 0) {
    return mergeLinterSettings(groups, saved);
  }
  const out: LinterSettingsMap = {};
  for (const [id, defaults] of Object.entries(FALLBACK_LINTER_DEFAULTS)) {
    out[id] = { ...defaults, ...(saved?.[id] ?? {}) };
  }
  if (saved) {
    for (const [id, vals] of Object.entries(saved)) {
      if (!out[id]) out[id] = { ...vals };
    }
  }
  return out;
}

export function defaultLinterSettings(
  groups: LanguageLinterGroup[],
): LinterSettingsMap {
  const out: LinterSettingsMap = {};
  for (const group of groups) {
    out[group.id] = {
      enabled: true,
      linter_id: group.defaultLinterId,
      min_level: group.defaultLevel,
      sample_limit: 20,
    };
  }
  return out;
}

export function mergeLinterSettings(
  groups: LanguageLinterGroup[],
  saved: LinterSettingsMap | undefined | null,
): LinterSettingsMap {
  const defaults = defaultLinterSettings(groups);
  if (!saved) return defaults;
  const out: LinterSettingsMap = { ...defaults };
  for (const [id, vals] of Object.entries(saved)) {
    out[id] = { ...(out[id] ?? {}), ...vals };
  }
  return out;
}

export function selectedLinterForGroup(
  group: LanguageLinterGroup,
  settings: LinterSettingsMap,
): LinterOption | undefined {
  const linterId =
    (settings[group.id]?.linter_id as string | undefined) ?? group.defaultLinterId;
  return group.linters.find((l) => l.id === linterId);
}
