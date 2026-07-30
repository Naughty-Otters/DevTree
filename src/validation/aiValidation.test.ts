import { describe, expect, it } from "vitest";
import {
  clampRuntimeSettings,
  defaultAiValidationRuntimeSettings,
  migrateRuntimeSettings,
  RUNTIME_TURNS_LIMITS,
} from "./aiValidation";

describe("aiValidation runtime settings", () => {
  it("returns sensible defaults", () => {
    const defaults = defaultAiValidationRuntimeSettings();
    expect(defaults.maxTurns).toBe(RUNTIME_TURNS_LIMITS.defaultValidation);
    expect(defaults.agentMaxTurns).toBe(RUNTIME_TURNS_LIMITS.defaultAgent);
  });

  it("clamps out-of-range values", () => {
    const clamped = clampRuntimeSettings({
      maxTurns: 9999,
      agentMaxTurns: 0,
    });
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
