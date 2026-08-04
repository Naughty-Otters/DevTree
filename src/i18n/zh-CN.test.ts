import { describe, expect, it } from "vitest";
import { en } from "./en";
import { zhCN } from "./zh-CN";

describe("i18n/zh-CN", () => {
  it("exports a Chinese catalog covering every English key", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });

  it("provides Simplified Chinese for core shell strings", () => {
    expect(zhCN["toolbar.settings"]).toBe("设置");
    expect(zhCN["tab.report"]).toBe("报告");
    expect(zhCN["language.option.zhCN"]).toBe("简体中文");
    expect(zhCN["settings.section.general"]).toBe("通用");
  });

  it("uses non-empty string values for every key", () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(typeof value, key).toBe("string");
      expect(value.length, key).toBeGreaterThan(0);
    }
  });
});
