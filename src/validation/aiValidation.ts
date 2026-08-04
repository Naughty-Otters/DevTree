import type { LlmProviderId, LlmProviderInfo } from "../agent/types";
import { DEFAULT_LLM_PROVIDER, isCliLlmProvider } from "../agent/types";
import type { RuleSettingDef, RuleSettingsMap } from "../analysis/types";

/** Runtime limits for LLM agent loops (tool-call rounds + token budget). */
export interface AiValidationRuntimeSettings {
  /** Max tool-call turns per AI validation rule / session scale base. */
  maxTurns: number;
  /** Max tool-call turns for interactive agent skills. */
  agentMaxTurns: number;
  /** Session token budget for AI validation. `0` = unlimited. */
  maxTokens: number;
}

export const RUNTIME_TURNS_LIMITS = {
  min: 4,
  validationMax: 512,
  agentMax: 256,
  defaultValidation: 128,
  defaultAgent: 64,
  /** Previous defaults — used to migrate persisted settings. */
  legacyDefaultValidation: 48,
  legacyDefaultAgent: 32,
} as const;

export const RUNTIME_TOKEN_LIMITS = {
  /** 0 means unlimited. */
  unlimited: 0,
  minWhenSet: 1_000,
  max: 2_000_000,
  defaultValidation: 0,
} as const;

export function defaultAiValidationRuntimeSettings(): AiValidationRuntimeSettings {
  return {
    maxTurns: RUNTIME_TURNS_LIMITS.defaultValidation,
    agentMaxTurns: RUNTIME_TURNS_LIMITS.defaultAgent,
    maxTokens: RUNTIME_TOKEN_LIMITS.defaultValidation,
  };
}

export function clampRuntimeSettings(
  settings: AiValidationRuntimeSettings,
): AiValidationRuntimeSettings {
  return {
    maxTurns: clampInt(
      settings.maxTurns,
      RUNTIME_TURNS_LIMITS.min,
      RUNTIME_TURNS_LIMITS.validationMax,
      RUNTIME_TURNS_LIMITS.defaultValidation,
    ),
    agentMaxTurns: clampInt(
      settings.agentMaxTurns,
      RUNTIME_TURNS_LIMITS.min,
      RUNTIME_TURNS_LIMITS.agentMax,
      RUNTIME_TURNS_LIMITS.defaultAgent,
    ),
    maxTokens: clampTokenBudget(settings.maxTokens ?? RUNTIME_TOKEN_LIMITS.unlimited),
  };
}

/** Bump users still on legacy defaults so large projects get enough turns. */
export function migrateRuntimeSettings(
  settings?: AiValidationRuntimeSettings,
): AiValidationRuntimeSettings {
  const clamped = clampRuntimeSettings(settings ?? defaultAiValidationRuntimeSettings());
  if (!settings) return clamped;
  return {
    maxTurns:
      settings.maxTurns === RUNTIME_TURNS_LIMITS.legacyDefaultValidation
        ? RUNTIME_TURNS_LIMITS.defaultValidation
        : clamped.maxTurns,
    agentMaxTurns:
      settings.agentMaxTurns === RUNTIME_TURNS_LIMITS.legacyDefaultAgent
        ? RUNTIME_TURNS_LIMITS.defaultAgent
        : clamped.agentMaxTurns,
    maxTokens: clamped.maxTokens,
  };
}

function clampTokenBudget(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return RUNTIME_TOKEN_LIMITS.unlimited;
  return Math.min(
    RUNTIME_TOKEN_LIMITS.max,
    Math.max(RUNTIME_TOKEN_LIMITS.minWhenSet, Math.round(value)),
  );
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** User-defined LLM configuration with API key. Exactly one may be global. */
export interface LlmConfiguration {
  id: string;
  name: string;
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  isGlobal: boolean;
}

/** Resolved at runtime for the backend. */
export interface AiValidationLlmSettings {
  provider: LlmProviderId;
  model: string;
  apiKey: string;
}

/** @deprecated Use LlmConfiguration */
export interface LlmProviderConfig {
  apiKey: string;
}

/** @deprecated Use LlmConfiguration[] */
export type LlmProviderConfigsMap = Partial<Record<LlmProviderId, LlmProviderConfig>>;

/** @deprecated Global is derived from LlmConfiguration.isGlobal */
export interface AiValidationGlobalLlm {
  provider: LlmProviderId;
  model: string;
}

export const AI_LLM_SETTING_KEYS = {
  override: "llm_override",
  configId: "llm_config_id",
  /** @deprecated Use configId */
  provider: "llm_provider",
  /** @deprecated Use configId */
  model: "llm_model",
} as const;

/** Selectable architecture assessment areas for `ai_architecture`. */
export const ARCHITECTURE_ASSESSMENT_KEYS = [
  "arch_patterns",
  "arch_system_design",
  "arch_scalability",
  "arch_technology",
  "arch_integration",
  "arch_security",
  "arch_performance",
  "arch_data",
  "arch_technical_debt",
] as const;

export type ArchitectureAssessmentKey = (typeof ARCHITECTURE_ASSESSMENT_KEYS)[number];

const ARCHITECTURE_ASSESSMENT_LABELS: Record<ArchitectureAssessmentKey, string> = {
  arch_patterns: "Architecture patterns",
  arch_system_design: "System design",
  arch_scalability: "Scalability",
  arch_technology: "Technology stack",
  arch_integration: "Integration patterns",
  arch_security: "Security architecture",
  arch_performance: "Performance architecture",
  arch_data: "Data architecture",
  arch_technical_debt: "Technical debt",
};

export function isArchitectureAssessmentKey(key: string): boolean {
  return (ARCHITECTURE_ASSESSMENT_KEYS as readonly string[]).includes(key);
}

export function architectureAssessmentSettingDefs(): RuleSettingDef[] {
  return ARCHITECTURE_ASSESSMENT_KEYS.map((key) => ({
    key,
    label: `Assess: ${ARCHITECTURE_ASSESSMENT_LABELS[key]}`,
    kind: "boolean" as const,
    default: true,
  }));
}

/** Selectable code-review lenses for `ai_code_review`. */
export const CODE_REVIEW_LENS_KEYS = [
  "review_performance",
  "review_security",
  "review_universal_quality",
  "review_common_bugs",
  "review_sql_injection",
  "review_xss",
  "review_n_plus_one",
  "review_error_handling",
  "review_async_concurrency",
  "review_anti_patterns",
  "review_logging",
] as const;

export type CodeReviewLensKey = (typeof CODE_REVIEW_LENS_KEYS)[number];

const CODE_REVIEW_LENS_LABELS: Record<CodeReviewLensKey, string> = {
  review_performance: "Performance",
  review_security: "Security",
  review_universal_quality: "Universal quality",
  review_common_bugs: "Common bugs",
  review_sql_injection: "SQL injection",
  review_xss: "XSS prevention",
  review_n_plus_one: "N+1 queries",
  review_error_handling: "Error handling",
  review_async_concurrency: "Async & concurrency",
  review_anti_patterns: "Anti-patterns",
  review_logging: "Logging strategy",
};

export function isCodeReviewLensKey(key: string): boolean {
  return (CODE_REVIEW_LENS_KEYS as readonly string[]).includes(key);
}

export function codeReviewLensSettingDefs(): RuleSettingDef[] {
  return CODE_REVIEW_LENS_KEYS.map((key) => ({
    key,
    label: `Review: ${CODE_REVIEW_LENS_LABELS[key]}`,
    kind: "boolean" as const,
    default: true,
  }));
}

/** Selectable Clean Code principles for `ai_clean_code`. */
export const CLEAN_CODE_PRINCIPLE_KEYS = [
  "clean_general",
  "clean_design",
  "clean_understandability",
  "clean_code_structure",
  "clean_meaningful_names",
  "clean_functions",
  "clean_single_responsibility",
  "clean_dry",
  "clean_comments",
  "clean_error_handling",
  "clean_boundaries",
  "clean_unit_tests",
  "clean_classes_and_data",
  "clean_code_smells",
  "clean_boy_scout",
] as const;

export type CleanCodePrincipleKey = (typeof CLEAN_CODE_PRINCIPLE_KEYS)[number];

const CLEAN_CODE_PRINCIPLE_LABELS: Record<CleanCodePrincipleKey, string> = {
  clean_general: "General rules",
  clean_design: "Design rules",
  clean_understandability: "Understandability",
  clean_code_structure: "Source code structure",
  clean_meaningful_names: "Meaningful names",
  clean_functions: "Functions",
  clean_single_responsibility: "Single responsibility",
  clean_dry: "DRY",
  clean_comments: "Comments",
  clean_error_handling: "Error handling",
  clean_boundaries: "Boundaries",
  clean_unit_tests: "Unit tests",
  clean_classes_and_data: "Classes & data",
  clean_code_smells: "Code smells",
  clean_boy_scout: "Boy Scout rule",
};

export function isCleanCodePrincipleKey(key: string): boolean {
  return (CLEAN_CODE_PRINCIPLE_KEYS as readonly string[]).includes(key);
}

export function cleanCodePrincipleSettingDefs(): RuleSettingDef[] {
  return CLEAN_CODE_PRINCIPLE_KEYS.map((key) => ({
    key,
    label: `Principle: ${CLEAN_CODE_PRINCIPLE_LABELS[key]}`,
    kind: "boolean" as const,
    default: true,
  }));
}

export function aiRuleCategoryLabel(category: string): string {
  if (category === "ai") return "AI Validation";
  if (category === "security") return "Security";
  return category;
}

export function shouldShowAiRuleSetting(ruleId: string, key: string): boolean {
  if (key === AI_LLM_SETTING_KEYS.override) return true;
  if (ruleId === "ai_architecture" && isArchitectureAssessmentKey(key)) return true;
  if (ruleId === "ai_code_review" && isCodeReviewLensKey(key)) return true;
  if (ruleId === "ai_clean_code" && isCleanCodePrincipleKey(key)) return true;
  return false;
}

export function defaultLlmConfigurations(): LlmConfiguration[] {
  return [];
}

export function createLlmConfiguration(
  partial?: Partial<LlmConfiguration> & { isGlobal?: boolean },
): LlmConfiguration {
  return {
    id: partial?.id ?? crypto.randomUUID(),
    name: partial?.name ?? "",
    provider: partial?.provider ?? DEFAULT_LLM_PROVIDER,
    apiKey: partial?.apiKey ?? "",
    model: partial?.model ?? "",
    isGlobal: partial?.isGlobal ?? false,
  };
}

export function isLlmConfigurationReady(config: LlmConfiguration): boolean {
  if (isCliLlmProvider(config.provider)) {
    return true;
  }
  return Boolean(config.apiKey.trim());
}

export function configuredLlmConfigurations(
  configs: LlmConfiguration[],
): LlmConfiguration[] {
  return configs.filter(isLlmConfigurationReady);
}

export function getGlobalConfiguration(
  configs: LlmConfiguration[],
): LlmConfiguration | undefined {
  return configs.find((config) => config.isGlobal);
}

export function setGlobalConfiguration(
  configs: LlmConfiguration[],
  id: string,
): LlmConfiguration[] {
  return configs.map((config) => ({
    ...config,
    isGlobal: config.id === id,
  }));
}

export function ensureSingleGlobal(configs: LlmConfiguration[]): LlmConfiguration[] {
  if (configs.length === 0) return configs;

  const ready = configuredLlmConfigurations(configs);
  const global = configs.find((config) => config.isGlobal);
  if (global) {
    return configs.map((config) => ({
      ...config,
      isGlobal: config.id === global.id,
    }));
  }

  const fallback = ready[0] ?? configs[0]!;
  return configs.map((config) => ({
    ...config,
    isGlobal: config.id === fallback.id,
  }));
}

export function configurationLabel(
  config: LlmConfiguration,
  providers: LlmProviderInfo[],
): string {
  const name = config.name.trim();
  if (name) return name;
  const provider = providers.find((entry) => entry.id === config.provider);
  return provider?.label ?? config.provider;
}

export function resolveGlobalLlm(
  configs: LlmConfiguration[],
): AiValidationLlmSettings {
  const global = getGlobalConfiguration(configs);
  if (!global) {
    return {
      provider: DEFAULT_LLM_PROVIDER,
      model: "",
      apiKey: "",
    };
  }
  return {
    provider: global.provider,
    model: global.model,
    apiKey: global.apiKey.trim(),
  };
}

export function isAiValidationRuleId(ruleId: string): boolean {
  return ruleId.startsWith("ai_");
}

export function aiRuleLlmSettingDefs(): RuleSettingDef[] {
  return [
    {
      key: AI_LLM_SETTING_KEYS.override,
      label: "Override global LLM settings",
      kind: "boolean",
      default: false,
    },
  ];
}

export function resolveAiValidationLlm(
  configs: LlmConfiguration[],
  ruleId: string,
  ruleSettings: RuleSettingsMap,
): AiValidationLlmSettings {
  const cfg = ruleSettings[ruleId];
  if (!cfg?.[AI_LLM_SETTING_KEYS.override]) {
    return resolveGlobalLlm(configs);
  }

  const configId = String(cfg[AI_LLM_SETTING_KEYS.configId] ?? "").trim();
  if (configId) {
    const found = configs.find((config) => config.id === configId);
    if (found && isLlmConfigurationReady(found)) {
      return {
        provider: found.provider,
        model: found.model,
        apiKey: found.apiKey.trim(),
      };
    }
  }

  // Legacy per-rule provider/model override
  const global = getGlobalConfiguration(configs);
  const providerRaw = String(cfg[AI_LLM_SETTING_KEYS.provider] ?? "").trim();
  const provider = (providerRaw || global?.provider || DEFAULT_LLM_PROVIDER) as LlmProviderId;
  const modelRaw = String(cfg[AI_LLM_SETTING_KEYS.model] ?? "").trim();
  const model = modelRaw || global?.model || "";

  const matched =
    configs.find((config) => config.provider === provider && isLlmConfigurationReady(config)) ??
    configs.find((config) => config.provider === provider);

  return {
    provider,
    model,
    apiKey: matched?.apiKey.trim() ?? "",
  };
}

export function migratePersistedAiSettings(
  raw: Partial<{
    llmConfigurations?: LlmConfiguration[];
    llmProviderConfigs?: LlmProviderConfigsMap;
    aiValidationLlm?: Partial<AiValidationGlobalLlm & { apiKey?: string }>;
  }>,
): { llmConfigurations: LlmConfiguration[] } {
  if (raw.llmConfigurations && raw.llmConfigurations.length > 0) {
    return {
      llmConfigurations: ensureSingleGlobal(
        raw.llmConfigurations.map((config) => ({
          ...createLlmConfiguration(config),
          id: config.id || crypto.randomUUID(),
        })),
      ),
    };
  }

  const configs: LlmConfiguration[] = [];
  const legacyMap = raw.llmProviderConfigs ?? {};
  for (const [provider, entry] of Object.entries(legacyMap)) {
    const apiKey = entry?.apiKey?.trim() ?? "";
    if (!apiKey) continue;
    configs.push(
      createLlmConfiguration({
        name: provider,
        provider: provider as LlmProviderId,
        apiKey,
      }),
    );
  }

  const legacy = raw.aiValidationLlm ?? {};
  const globalProvider = (legacy.provider ?? DEFAULT_LLM_PROVIDER) as LlmProviderId;
  const globalModel = legacy.model ?? "";

  if (legacy.apiKey?.trim()) {
    const existing = configs.find((config) => config.provider === globalProvider);
    if (existing) {
      existing.apiKey = legacy.apiKey.trim();
      existing.model = globalModel || existing.model;
      existing.isGlobal = true;
    } else {
      configs.push(
        createLlmConfiguration({
          name: "Global",
          provider: globalProvider,
          apiKey: legacy.apiKey.trim(),
          model: globalModel,
          isGlobal: true,
        }),
      );
    }
  } else {
    const existing = configs.find((config) => config.provider === globalProvider);
    if (existing) {
      existing.model = globalModel || existing.model;
      existing.isGlobal = true;
    } else if (globalModel) {
      configs.push(
        createLlmConfiguration({
          name: "Global",
          provider: globalProvider,
          model: globalModel,
          isGlobal: true,
        }),
      );
    }
  }

  return { llmConfigurations: ensureSingleGlobal(configs) };
}
