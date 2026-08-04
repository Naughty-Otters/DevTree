import { describe, expect, it, vi } from "vitest";
import { renderModulesList } from "./modulesList";
import type { GraphNode } from "../graph/types";
import { initLocale } from "../i18n";

const sampleNodes: GraphNode[] = [
  {
    id: "a",
    label: "alpha",
    path: "src/a.ts",
    kind: "file",
    loc: 10,
  },
  {
    id: "b",
    label: "beta",
    path: "src/b.ts",
    kind: "file",
    loc: 20,
  },
  {
    id: "c",
    label: "gamma",
    path: "src/c.ts",
    kind: "file",
    loc: 30,
  },
];

const sampleEdges = [
  { source: "a", target: "b", kind: "import" },
  { source: "c", target: "a", kind: "import" },
];

describe("ui/modulesList", () => {
  it("exports renderModulesList", () => {
    expect(typeof renderModulesList).toBe("function");
  });

  it("shows a loading placeholder while the graph hydrates", () => {
    initLocale("en");
    const container = document.createElement("div");
    renderModulesList(
      container,
      {
        graphNodes: [],
        graphEdges: [],
        visibleIds: new Set(),
        searchQuery: "",
        loading: true,
      },
      {
        onFocus: vi.fn(),
        onVisibilityChange: vi.fn(),
        onHighlight: vi.fn(),
      },
    );
    expect(container.querySelector(".loading-placeholder")).toBeTruthy();
    expect(container.textContent).toContain("Loading modules");
  });

  it("reports hover highlights for modules in the list", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onHighlight = vi.fn();
    renderModulesList(
      container,
      {
        graphNodes: sampleNodes,
        graphEdges: sampleEdges,
        visibleIds: new Set(["a"]),
        searchQuery: "",
      },
      {
        onFocus: vi.fn(),
        onVisibilityChange: vi.fn(),
        onHighlight,
      },
    );

    const rowA = container.querySelector<HTMLElement>('.module-row[data-node-id="a"]')!;
    const rowB = container.querySelector<HTMLElement>('.module-row[data-node-id="b"]')!;
    expect(rowA).toBeTruthy();
    expect(rowB).toBeTruthy();

    rowA.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(onHighlight).toHaveBeenLastCalledWith("a");

    rowA.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(onHighlight).toHaveBeenLastCalledWith(null);

    rowB.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(onHighlight).toHaveBeenLastCalledWith("b");

    container.remove();
  });

  it("shows only related modules and can deselect that related set", () => {
    initLocale("en");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onVisibilityChange = vi.fn();
    const state = {
      graphNodes: sampleNodes,
      graphEdges: sampleEdges,
      visibleIds: new Set<string>(["a", "b", "c"]),
      searchQuery: "",
    };

    renderModulesList(container, state, {
      onFocus: vi.fn(),
      onVisibilityChange,
      onHighlight: vi.fn(),
    });

    // From b: related is a+b only — c must be deselected.
    container
      .querySelector<HTMLElement>('.module-row[data-node-id="b"]')!
      .querySelector<HTMLButtonElement>(".module-row-menu-btn")!
      .click();
    const menu = document.querySelector<HTMLElement>(".module-actions-menu")!;
    [...menu.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Show only related"))!
      .click();

    const onlyRelated = onVisibilityChange.mock.calls.at(-1)![0] as Set<string>;
    expect([...onlyRelated].sort()).toEqual(["a", "b"]);
    expect(state.visibleIds).toEqual(onlyRelated);

    // Deselect related from a (a+b+c in neighborhood) removes remaining visible related ids.
    container
      .querySelector<HTMLElement>('.module-row[data-node-id="a"]')!
      .querySelector<HTMLButtonElement>(".module-row-menu-btn")!
      .click();
    const menu2 = document.querySelector<HTMLElement>(".module-actions-menu")!;
    [...menu2.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Deselect related"))!
      .click();

    const deselected = onVisibilityChange.mock.calls.at(-1)![0] as Set<string>;
    expect([...deselected]).toEqual([]);

    container.remove();
  });
});
