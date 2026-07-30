import { describe, expect, it } from "vitest";
import {
  AI_LLM_SETTING_KEYS,
  aiRuleCategoryLabel,
  architectureAssessmentSettingDefs,
  clampRuntimeSettings,
  cleanCodePrincipleSettingDefs,
  codeReviewLensSettingDefs,
  configurationLabel,
  configuredLlmConfigurations,
  createLlmConfiguration,
  defaultAiValidationRuntimeSettings,
  defaultLlmConfigurations,
  ensureSingleGlobal,
  isAiValidationRuleId,
  isArchitectureAssessmentKey,
  isCleanCodePrincipleKey,
  isCodeReviewLensKey,
  isLlmConfigurationReady,
  migratePersistedAiSettings,
  migrateRuntimeSettings,
  resolveAiValidationLlm,
  resolveGlobalLlm,
  RUNTIME_TURNS_LIMITS,
  setGlobalConfiguration,
  shouldShowAiRuleSetting,
} from "./aiValidation";

describe("aiValidation runtime settings", () => {
  it("returns sensible defaults", () => {
    const defaults = defaultAiValidationRuntimeSettings();
    expect(defaults.maxTurns).toBe(RUNTIME_TURNS_LIMITS.defaultValidation);
    expect(defaults.agentMaxTurns).toBe(RUNTIME_TURNS_LIMITS.defaultAgent);
  });

  it("clamps out-of-range values", () => {
    const clamped = clampRuntimeSettings({ maxTurns: 9999, agentMaxTurns: 0 });
    expect(clamped.maxTurns).toBe(RUNTIME_TURNS_LIMITS.validationMax);
    expect(clamped.agentMaxTurns).toBe(RUNTIME_TURNS_LIMITS.min);
  });

  it("migrates legacy default turn limits", () => {
    const migrated = migrateRuntimeSettings({
      maxTurns: RUNTIME_TURNS_LIMITS.legacyDefaultValidation,
      agentMaxTurns: RUNTIME_TURNS_LIMITS.legacyDefaultAgent,
    });
    expect(migrated.maxTurns).toBe(RUNTIME_TURNS_LIMITS.defaultValidation);
    expect(migrated.agentMaxTurns).toBe(RUNTIME_TURNS_LIMITS.defaultAgent);
  });
});

describe("aiValidation LLM configuration", () => {
  const ready = createLlmConfiguration({
    id: "cfg-1",
    name: "Work",
    provider: "openai",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    isGlobal: true,
  });

  it("detects AI rule ids and architecture keys", () => {
    expect(isAiValidationRuleId("ai_architecture")).toBe(true);
    expect(isArchitectureAssessmentKey("arch_security")).toBe(true);
    expect(architectureAssessmentSettingDefs().length).toBeGreaterThan(0);
    expect(shouldShowAiRuleSetting("ai_architecture", "arch_security")).toBe(true);
    expect(shouldShowAiRuleSetting("ai_other", AI_LLM_SETTING_KEYS.override)).toBe(true);
  });

  it("detects code review lens keys", () => {
    expect(isAiValidationRuleId("ai_code_review")).toBe(true);
    expect(isCodeReviewLensKey("review_security")).toBe(true);
    expect(codeReviewLensSettingDefs()).toHaveLength(11);
    expect(shouldShowAiRuleSetting("ai_code_review", "review_logging")).toBe(true);
    expect(shouldShowAiRuleSetting("ai_architecture", "review_logging")).toBe(false);
  });

  it("detects clean code principle keys", () => {
    expect(isAiValidationRuleId("ai_clean_code")).toBe(true);
    expect(isCleanCodePrincipleKey("clean_dry")).toBe(true);
    expect(cleanCodePrincipleSettingDefs()).toHaveLength(11);
    expect(shouldShowAiRuleSetting("ai_clean_code", "clean_boy_scout")).toBe(true);
    expect(aiRuleCategoryLabel("ai")).toBe("AI Validation");
  });

  it("manages global LLM configuration", () => {
    expect(defaultLlmConfigurations()).toEqual([]);
    expect(isLlmConfigurationReady(ready)).toBe(true);
    expect(configuredLlmConfigurations([ready])).toHaveLength(1);
    expect(resolveGlobalLlm([ready]).apiKey).toBe("sk-test");
    expect(configurationLabel(ready, [{ id: "openai", label: "OpenAI" }])).toBe("Work");
  });

  it("ensures a single global configuration", () => {
    const other = createLlmConfiguration({ id: "cfg-2", apiKey: "key", isGlobal: true });
    const merged = ensureSingleGlobal([ready, other]);
    expect(merged.filter((c) => c.isGlobal)).toHaveLength(1);
    const set = setGlobalConfiguration([ready, other], "cfg-2");
    expect(set.find((c) => c.id === "cfg-2")?.isGlobal).toBe(true);
  });

  it("resolves per-rule LLM overrides", () => {
    const global = resolveAiValidationLlm([ready], "ai_architecture", {});
    expect(global.apiKey).toBe("sk-test");

    const override = resolveAiValidationLlm([ready], "ai_architecture", {
      ai_architecture: {
        [AI_LLM_SETTING_KEYS.override]: true,
        [AI_LLM_SETTING_KEYS.configId]: "cfg-1",
      },
    });
    expect(override.model).toBe("gpt-4o-mini");
  });

  it("migrates legacy persisted provider settings", () => {
    const migrated = migratePersistedAiSettings({
      llmProviderConfigs: { openai: { apiKey: "legacy-key" } },
      aiValidationLlm: { provider: "openai", model: "gpt-4", apiKey: "legacy-key" },
    });
    expect(migrated.llmConfigurations.length).toBeGreaterThan(0);
    expect(migrated.llmConfigurations.some((c) => c.isGlobal)).toBe(true);
  });

  it("resolves legacy provider override without config id", () => {
    const cfg = createLlmConfiguration({
      id: "legacy",
      provider: "anthropic",
      apiKey: "anthropic-key",
      model: "claude-3",
    });
    const resolved = resolveAiValidationLlm([cfg], "ai_test", {
      ai_test: {
        [AI_LLM_SETTING_KEYS.override]: true,
        [AI_LLM_SETTING_KEYS.provider]: "anthropic",
        [AI_LLM_SETTING_KEYS.model]: "claude-3",
      },
    });
    expect(resolved.provider).toBe("anthropic");
    expect(resolved.apiKey).toBe("anthropic-key");
  });
});
