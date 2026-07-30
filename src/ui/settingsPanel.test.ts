import { describe, expect, it } from "vitest";
import { createSettingsPanel } from "./settingsPanel";

describe("settingsPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createSettingsPanel(container, { onClose: () => {} })).not.toThrow();
    expect(container).toBeDefined();
  });
});
