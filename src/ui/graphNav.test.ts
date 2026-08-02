import { describe, expect, it } from "vitest";
import { renderGraphNav } from "./graphNav";
import { rootNavigation } from "../graph/navigation";
import { DEFAULT_MODULE_FILTERS } from "../graph/moduleFilters";

describe("ui/graphNav", () => {
  it("exports renderGraphNav", () => {
    expect(typeof renderGraphNav).toBe("function");
  });

  it("renders layout family icon buttons and DAG flow when DAG is selected", () => {
    const container = document.createElement("div");
    let changed: string | null = null;
    renderGraphNav(
      container,
      rootNavigation(),
      false,
      false,
      {
        onBack: () => {},
        onForward: () => {},
        onNavigate: () => {},
        onLayoutModeChange: (mode) => {
          changed = mode;
        },
      },
      { layoutMode: "hierarchical" },
    );

    const layoutBtns = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Graph layout"] .graph-nav-icon-btn',
    );
    expect(layoutBtns.length).toBe(6);
    const dagBtn = [...layoutBtns].find((b) => b.getAttribute("aria-label") === "DAG / Lines");
    expect(dagBtn?.classList.contains("is-active")).toBe(true);

    const flowGroup = container.querySelector<HTMLElement>('[aria-label="DAG flow style"]');
    expect(flowGroup).toBeTruthy();
    expect(flowGroup?.parentElement?.hidden).toBe(false);

    const hierarchical = flowGroup!.querySelector<HTMLButtonElement>(
      '[aria-label="Hierarchical"]',
    );
    expect(hierarchical?.classList.contains("is-active")).toBe(true);

    const direct = flowGroup!.querySelector<HTMLButtonElement>('[aria-label="Direct"]');
    direct!.click();
    expect(changed).toBe("direct");

    const organic = [...layoutBtns].find((b) => b.getAttribute("aria-label") === "Organic");
    organic!.click();
    expect(changed).toBe("organic");
    expect(flowGroup?.parentElement?.hidden).toBe(true);
  });

  it("renders edge style icon buttons", () => {
    const container = document.createElement("div");
    let changed: string | null = null;
    renderGraphNav(
      container,
      rootNavigation(),
      false,
      false,
      {
        onBack: () => {},
        onForward: () => {},
        onNavigate: () => {},
        onEdgeStyleChange: (style) => {
          changed = style;
        },
      },
      { edgeStyle: "straight" },
    );

    const edges = container.querySelector('[aria-label="Edge style"]');
    expect(edges).toBeTruthy();
    const orthogonal = edges!.querySelector<HTMLButtonElement>(
      '[aria-label="Orthogonal"]',
    );
    orthogonal!.click();
    expect(changed).toBe("orthogonal");
  });

  it("renders module filter toggles", () => {
    const container = document.createElement("div");
    let filters = { ...DEFAULT_MODULE_FILTERS };
    renderGraphNav(
      container,
      rootNavigation(),
      false,
      false,
      {
        onBack: () => {},
        onForward: () => {},
        onNavigate: () => {},
        onModuleFiltersChange: (next) => {
          filters = next;
        },
      },
      { moduleFilters: DEFAULT_MODULE_FILTERS },
    );

    const details = container.querySelector("details.graph-nav-filter:not(.graph-nav-language-filter)");
    expect(details).toBeTruthy();
    const boxes = details!.querySelectorAll<HTMLInputElement>(
      ".graph-nav-filter-option input",
    );
    expect(boxes.length).toBe(4);

    const hub = [...boxes].find((b) =>
      b.parentElement?.textContent?.includes("Hubs"),
    );
    expect(hub).toBeTruthy();
    hub!.checked = false;
    hub!.dispatchEvent(new Event("change"));
    expect(filters.hub).toBe(false);
  });

  it("renders language filter toggles", () => {
    const container = document.createElement("div");
    let filters = {
      typescript: true,
      rust: true,
      python: true,
      go: true,
      other: true,
    };
    renderGraphNav(
      container,
      rootNavigation(),
      false,
      false,
      {
        onBack: () => {},
        onForward: () => {},
        onNavigate: () => {},
        onLanguageFiltersChange: (next) => {
          filters = next;
        },
      },
      {
        languageFilters: filters,
        presentLanguages: ["typescript", "rust"],
      },
    );

    const details = container.querySelector("details.graph-nav-language-filter");
    expect(details).toBeTruthy();
    const boxes = details!.querySelectorAll<HTMLInputElement>(
      ".graph-nav-filter-option input",
    );
    expect(boxes.length).toBe(2);
    expect(details!.textContent).toContain("TypeScript");
    expect(details!.textContent).toContain("Rust");
    expect(details!.textContent).not.toContain("Python");

    const rust = [...boxes].find((b) =>
      b.parentElement?.textContent?.includes("Rust"),
    );
    rust!.checked = false;
    rust!.dispatchEvent(new Event("change"));
    expect(filters.rust).toBe(false);
  });

  it("renders Focus in the graph view button list", () => {
    const container = document.createElement("div");
    let focused = false;
    renderGraphNav(
      container,
      rootNavigation(),
      false,
      false,
      {
        onBack: () => {},
        onForward: () => {},
        onNavigate: () => {},
        onFocusView: () => {
          focused = true;
        },
      },
      { focusEnabled: true },
    );

    const focusBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Graph view actions"] [aria-label="Focus"]',
    );
    expect(focusBtn).toBeTruthy();
    expect(focusBtn!.disabled).toBe(false);
    focusBtn!.click();
    expect(focused).toBe(true);
  });

  it("shows a Run analysis action on the stale-imports banner", () => {
    const container = document.createElement("div");
    let ran = false;
    renderGraphNav(
      container,
      rootNavigation(),
      false,
      false,
      {
        onBack: () => {},
        onForward: () => {},
        onNavigate: () => {},
        onRunAnalysis: () => {
          ran = true;
        },
      },
      { staleImports: true },
    );
    const btn = container.querySelector<HTMLButtonElement>(
      ".graph-nav-warning button",
    );
    expect(btn?.textContent).toMatch(/Run analysis/i);
    btn!.click();
    expect(ran).toBe(true);
  });
});
