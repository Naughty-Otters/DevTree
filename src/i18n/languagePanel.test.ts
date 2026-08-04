import { beforeEach, describe, expect, it } from "vitest";
import { getLocale, initLocale, setLocale } from "./index";
import { createLanguagePanel } from "./languagePanel";

describe("i18n/languagePanel", () => {
  beforeEach(() => {
    localStorage.clear();
    initLocale("en");
  });

  it("renders locale options and marks the active one", () => {
    const host = document.createElement("div");
    const api = createLanguagePanel(host, () => {});
    expect(api.getLocale()).toBe("en");
    expect(host.querySelector(".language-panel-title")?.textContent).toBe(
      "Language",
    );
    const options = host.querySelectorAll<HTMLButtonElement>(".language-option");
    expect(options.length).toBe(2);
    expect(
      [...options].find((btn) => btn.classList.contains("is-active"))
        ?.textContent,
    ).toBe("English");
  });

  it("switches locale, notifies the caller, and re-renders", () => {
    const host = document.createElement("div");
    const changed: string[] = [];
    const api = createLanguagePanel(host, (locale) => changed.push(locale));

    const zhBtn = [...host.querySelectorAll<HTMLButtonElement>(".language-option")].find(
      (btn) => btn.textContent === "简体中文",
    )!;
    zhBtn.click();

    expect(getLocale()).toBe("zh-CN");
    expect(api.getLocale()).toBe("zh-CN");
    expect(changed).toEqual(["zh-CN"]);
    expect(host.querySelector(".language-panel-title")?.textContent).toBe(
      "界面语言",
    );
    expect(
      host.querySelector(".language-option.is-active")?.textContent,
    ).toBe("简体中文");
  });

  it("ignores clicks on the already-selected locale", () => {
    const host = document.createElement("div");
    const changed: string[] = [];
    createLanguagePanel(host, (locale) => changed.push(locale));
    setLocale("en");

    const enBtn = [...host.querySelectorAll<HTMLButtonElement>(".language-option")].find(
      (btn) => btn.classList.contains("is-active"),
    )!;
    enBtn.click();
    expect(changed).toEqual([]);
  });
});
