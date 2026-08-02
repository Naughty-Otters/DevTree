import { describe, expect, it, vi } from "vitest";
import { hideFlowOverlay, renderFlowOverlay } from "./flowOverlay";

describe("ui/flowOverlay", () => {
  it("renders title and interactive actions", () => {
    const root = document.createElement("div");
    root.className = "graph-overlay hidden";
    const onOpen = vi.fn();
    renderFlowOverlay(root, {
      title: "Open a project to get started",
      detail: "Browse a folder to begin.",
      actions: [{ label: "Open project", primary: true, onClick: onOpen }],
    });

    expect(root.classList.contains("hidden")).toBe(false);
    expect(root.classList.contains("flow-overlay-interactive")).toBe(true);
    expect(root.querySelector(".flow-overlay-title")?.textContent).toMatch(
      /Open a project/,
    );
    expect(root.querySelector(".flow-overlay-detail")?.textContent).toMatch(
      /Browse/,
    );
    const btn = root.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("hides and clears the overlay", () => {
    const root = document.createElement("div");
    renderFlowOverlay(root, { title: "Loading…" });
    hideFlowOverlay(root);
    expect(root.classList.contains("hidden")).toBe(true);
    expect(root.children.length).toBe(0);
    expect(root.classList.contains("flow-overlay-interactive")).toBe(false);
  });

  it("shows a spinner for busy titles", () => {
    const root = document.createElement("div");
    renderFlowOverlay(root, { title: "Computing layout…" });
    expect(root.querySelector(".flow-overlay-card.is-loading")).toBeTruthy();
    expect(root.querySelector(".loading-spinner")).toBeTruthy();
  });
});
