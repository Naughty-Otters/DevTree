import { describe, expect, it } from "vitest";
import { createSettingsPanel } from "./settingsPanel";

describe("settingsPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="settings-backdrop"></div>
      <button id="btn-close-settings"></button>
      <div class="settings-accordion"></div>
    `;
    expect(() => createSettingsPanel(container)).not.toThrow();
    expect(container).toBeDefined();
  });
});
