import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDomTranslations,
  en,
  getLocale,
  initLocale,
  isLocale,
  parseLocale,
  setLocale,
  t,
  zhCN,
} from "./index";

describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
    initLocale("en");
  });

  it("parses known locales and rejects unknown", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(parseLocale("zh-CN")).toBe("zh-CN");
    expect(parseLocale("nope")).toBe("en");
  });

  it("has matching keys in English and Chinese catalogs", () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zhCN).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("translates shell keys for Chinese", () => {
    setLocale("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    expect(t("toolbar.settings")).toBe("设置");
    expect(t("tab.report")).toBe("报告");
    expect(t("scoreHistory.overTime", { label: "总体" })).toBe("总体趋势");
  });

  it("applies data-i18n attributes in the DOM", () => {
    const host = document.createElement("div");
    host.innerHTML = `<span data-i18n="settings.title">Settings</span>`;
    setLocale("zh-CN");
    applyDomTranslations(host);
    expect(host.textContent).toBe("设置");
  });
});
