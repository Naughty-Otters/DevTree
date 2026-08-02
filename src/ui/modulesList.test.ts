import { describe, expect, it, vi } from "vitest";
import { renderModulesList } from "./modulesList";

const noopCallbacks = {
  onFocus: vi.fn(),
  onVisibilityChange: vi.fn(),
  onHighlight: vi.fn(),
};

describe("ui/modulesList", () => {
  it("exports renderModulesList", () => {
    expect(typeof renderModulesList).toBe("function");
  });

  it("shows a loading placeholder while the graph hydrates", () => {
    const container = document.createElement("div");
    renderModulesList(
      container,
      { graphNodes: [], visibleIds: new Set(), searchQuery: "", loading: true },
      noopCallbacks,
    );
    expect(container.querySelector(".loading-placeholder")).toBeTruthy();
    expect(container.textContent).toContain("Loading modules");
  });
});
