import { describe, expect, it } from "vitest";
import {
  createLoadingPlaceholder,
  isBusyOverlayTitle,
} from "./loadingPlaceholder";

describe("ui/loadingPlaceholder", () => {
  it("renders spinner and title", () => {
    const el = createLoadingPlaceholder({
      title: "Loading file ratings…",
      detail: "Large projects can take a moment.",
      size: "fill",
    });
    expect(el.classList.contains("loading-placeholder-fill")).toBe(true);
    expect(el.querySelector(".loading-spinner")).toBeTruthy();
    expect(el.textContent).toContain("Loading file ratings");
    expect(el.textContent).toContain("Large projects");
    expect(el.getAttribute("aria-busy")).toBe("true");
  });

  it("detects busy overlay titles", () => {
    expect(isBusyOverlayTitle("Loading dependency graph…")).toBe(true);
    expect(isBusyOverlayTitle("Computing layout…")).toBe(true);
    expect(isBusyOverlayTitle("Open a project to get started")).toBe(false);
  });
});
