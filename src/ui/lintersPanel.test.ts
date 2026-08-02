import { describe, expect, it } from "vitest";
import { createLintersPanel } from "./lintersPanel";

describe("ui/lintersPanel", () => {
  it("exports createLintersPanel", () => {
    expect(typeof createLintersPanel).toBe("function");
  });

  it("shows a loading placeholder while checking linters", () => {
    const container = document.createElement("div");
    createLintersPanel(
      container,
      {
        groups: [],
        settings: {},
        expandedLanguageId: null,
        installingKey: null,
        errors: {},
        loading: true,
      },
      {
        onRefresh: () => {},
        onInstall: async () => {},
        onSettingsChange: () => {},
      },
    );
    expect(container.querySelector(".loading-placeholder")).toBeTruthy();
    expect(container.textContent).toContain("Checking linters");
  });
});
