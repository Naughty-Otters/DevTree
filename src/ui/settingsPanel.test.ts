import { describe, expect, it } from "vitest";
import { createSettingsPanel } from "./settingsPanel";

describe("settingsPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("aside");
    container.id = "right-panel";
    container.className = "hidden";
    container.innerHTML = `
      <button id="btn-close-settings"></button>
      <div class="settings-accordion"></div>
    `;
    expect(() => createSettingsPanel(container)).not.toThrow();
    expect(container).toBeDefined();
  });

  it("toggles docked panel visibility without a backdrop", () => {
    const container = document.createElement("aside");
    container.id = "right-panel";
    container.className = "hidden";
    container.innerHTML = `
      <button id="btn-close-settings"></button>
      <div class="settings-accordion"></div>
    `;
    document.body.appendChild(container);

    const api = createSettingsPanel(container);
    expect(api.isOpen()).toBe(false);
    expect(container.classList.contains("hidden")).toBe(true);

    api.open();
    expect(api.isOpen()).toBe(true);
    expect(container.classList.contains("hidden")).toBe(false);
    expect(document.body.classList.contains("settings-open")).toBe(true);

    api.toggle();
    expect(api.isOpen()).toBe(false);
    expect(container.classList.contains("hidden")).toBe(true);

    container.remove();
  });

  it("opens a named settings accordion section", () => {
    const container = document.createElement("aside");
    container.id = "right-panel";
    container.className = "hidden";
    container.innerHTML = `
      <button id="btn-close-settings"></button>
      <div class="settings-accordion">
        <section class="settings-accordion-item is-open" data-settings-section="rules">
          <button class="settings-accordion-expand" aria-expanded="true"></button>
        </section>
        <section class="settings-accordion-item" data-settings-section="linters">
          <button class="settings-accordion-expand" aria-expanded="false"></button>
        </section>
      </div>
    `;
    document.body.appendChild(container);
    const api = createSettingsPanel(container);
    api.open("linters");
    const rules = container.querySelector('[data-settings-section="rules"]');
    const linters = container.querySelector('[data-settings-section="linters"]');
    expect(rules?.classList.contains("is-open")).toBe(false);
    expect(linters?.classList.contains("is-open")).toBe(true);
    container.remove();
  });
});
