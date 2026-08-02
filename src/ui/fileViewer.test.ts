import { describe, expect, it } from "vitest";
import { createFileViewer } from "./fileViewer";

describe("fileViewer", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createFileViewer(container, () => {})).not.toThrow();
    expect(container).toBeDefined();
  });

  it("shows a guide when no file is open", () => {
    const container = document.createElement("div");
    container.classList.add("hidden");
    const viewer = createFileViewer(container, () => {});
    viewer.showGuide();
    expect(container.classList.contains("hidden")).toBe(false);
    expect(container.querySelector(".file-viewer-empty")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(container.textContent).toMatch(/Project Tree/i);
  });

  it("shows a loading placeholder while opening a file", () => {
    const container = document.createElement("div");
    const viewer = createFileViewer(container, () => {});
    viewer.showLoading("src/app.ts");
    expect(container.querySelector(".loading-placeholder")).toBeTruthy();
    expect(container.textContent).toContain("Opening src/app.ts");
  });
});
