import { describe, expect, it } from "vitest";
import {
  defaultLinterSettings,
  ensureLinterSettings,
  FALLBACK_LINTER_DEFAULTS,
  mergeLinterSettings,
  selectedLinterForGroup,
  type LanguageLinterGroup,
} from "./types";

const mockGroup: LanguageLinterGroup = {
  id: "typescript",
  language: "typescript",
  label: "TypeScript",
  defaultLinterId: "eslint",
  defaultLevel: "warning",
  levels: [{ id: "warning", label: "Warning" }],
  linters: [
    {
      id: "eslint",
      label: "ESLint",
      status: "installed",
      installHint: "npm i eslint",
      isDefault: true,
    },
  ],
};

describe("linter/types", () => {
  it("ensures fallback linter settings", () => {
    const settings = ensureLinterSettings({});
    expect(settings.typescript?.linter_id).toBe(FALLBACK_LINTER_DEFAULTS.typescript.linter_id);
  });

  it("merges API groups with saved settings", () => {
    const defaults = defaultLinterSettings([mockGroup]);
    const merged = mergeLinterSettings([mockGroup], {
      typescript: { min_level: "error" },
    });
    expect(merged.typescript?.min_level).toBe("error");
    expect(defaults.typescript?.linter_id).toBe("eslint");
  });

  it("selects configured linter for a language group", () => {
    const settings = ensureLinterSettings({}, [mockGroup]);
    expect(selectedLinterForGroup(mockGroup, settings)?.id).toBe("eslint");
  });
});
