import { describe, expect, it } from "vitest";
import { en } from "./en";
import { zhCN } from "./zh-CN";

describe("i18n/en", () => {
  it("exports a non-empty English catalog", () => {
    const keys = Object.keys(en);
    expect(keys.length).toBeGreaterThan(50);
    expect(en["app.title"]).toBe("DevTree");
    expect(en["toolbar.settings"]).toBe("Settings");
    expect(en["language.option.en"]).toBe("English");
  });

  it("has the same keys as the Chinese catalog", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("uses non-empty string values for every key", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value, key).toBe("string");
      expect(value.length, key).toBeGreaterThan(0);
    }
  });
});
