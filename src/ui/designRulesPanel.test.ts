import { describe, expect, it, vi } from "vitest";
import { createDesignRulesPanel } from "./designRulesPanel";
import type { DesignRule } from "../analysis/designRules";

describe("createDesignRulesPanel", () => {
  it("renders empty state without throwing", () => {
    const container = document.createElement("div");
    expect(() =>
      createDesignRulesPanel(container, [], {
        onChange: vi.fn(),
      }),
    ).not.toThrow();
    expect(container.textContent).toContain("No rules yet");
  });

  it("renders layer and forbid cards", () => {
    const container = document.createElement("div");
    const rules: DesignRule[] = [
      {
        id: "L1",
        kind: "layers",
        layers: ["core", "ui"],
        enabled: true,
      },
      {
        id: "F1",
        kind: "forbid",
        from: "app",
        to: "lib",
        enabled: true,
      },
    ];
    createDesignRulesPanel(container, rules, {
      onChange: vi.fn(),
      packageIds: ["core", "ui", "app", "lib"],
    });
    expect(container.textContent).toContain("Layer stack");
    expect(container.textContent).toContain("Forbid dependency");
    expect(container.querySelectorAll(".design-rule-card")).toHaveLength(2);
    expect(container.querySelectorAll(".design-rule-package-trigger")).toHaveLength(4);
  });

  it("calls onChange when adding a forbid rule", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    createDesignRulesPanel(container, [], { onChange });
    const buttons = [...container.querySelectorAll("button")];
    const addForbid = buttons.find((b) => b.textContent === "Forbid dependency");
    expect(addForbid).toBeTruthy();
    addForbid!.click();
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]![0] as DesignRule[];
    expect(next).toHaveLength(1);
    expect(next[0]!.kind).toBe("forbid");
    expect(onChange.mock.calls[0]![1]).toEqual({ refreshPanel: true });
  });

  it("calls onSuggestLayers when suggest button clicked", () => {
    const container = document.createElement("div");
    const onSuggestLayers = vi.fn();
    createDesignRulesPanel(container, [], {
      onChange: vi.fn(),
      onSuggestLayers,
    });
    const suggest = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Suggest from DSM",
    );
    suggest!.click();
    expect(onSuggestLayers).toHaveBeenCalled();
  });

  it("shows package pickers when packageIds provided", () => {
    const container = document.createElement("div");
    createDesignRulesPanel(
      container,
      [{ id: "L1", kind: "layers", layers: ["core"], enabled: true }],
      {
        onChange: vi.fn(),
        packageIds: ["core", "ui"],
      },
    );
    expect(container.textContent).toContain("2 packages found");
    expect(
      container.querySelector(".design-rule-package-trigger"),
    ).toBeTruthy();
  });

  it("opens package menu with options on trigger click", () => {
    const container = document.createElement("div");
    createDesignRulesPanel(
      container,
      [{ id: "L1", kind: "layers", layers: [], enabled: true }],
      {
        onChange: vi.fn(),
        packageIds: ["core", "ui"],
      },
    );
    const trigger = container.querySelector(
      ".design-rule-package-trigger",
    ) as HTMLButtonElement;
    trigger.click();
    const menu = document.body.querySelector(".design-rule-package-menu");
    expect(menu).toBeTruthy();
    const options = document.body.querySelectorAll(".design-rule-package-option");
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect([...options].map((o) => o.textContent)).toContain("core");
    expect([...options].map((o) => o.textContent)).toContain("ui");
    if (menu?.parentElement) menu.parentElement.removeChild(menu);
  });

  it("does not request panel refresh when custom prefix typed", async () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    createDesignRulesPanel(
      container,
      [{ id: "F1", kind: "forbid", from: "", to: "", enabled: true }],
      {
        onChange,
        packageIds: ["core", "ui"],
      },
    );
    const trigger = container.querySelector(
      ".design-rule-package-trigger",
    ) as HTMLButtonElement;
    trigger.click();
    const customBtn = [...document.body.querySelectorAll(
      ".design-rule-package-option-custom",
    )].find((b) => b.textContent === "Custom path prefix…") as HTMLButtonElement;
    customBtn.click();
    const customInput = container.querySelector(
      ".design-rule-package-custom",
    ) as HTMLInputElement;
    customInput.value = "ui/widgets";
    customInput.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 450));
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![1]).toBeUndefined();
    document.body
      .querySelectorAll(".design-rule-package-menu")
      .forEach((m) => m.remove());
  });

  it("removes a rule via × button", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    createDesignRulesPanel(
      container,
      [{ id: "F1", kind: "forbid", from: "a", to: "b", enabled: true }],
      { onChange },
    );
    const remove = container.querySelector(
      ".design-rule-header button",
    ) as HTMLButtonElement;
    remove.click();
    expect(onChange).toHaveBeenCalledWith([], { refreshPanel: true });
  });

  it("toggles enabled checkbox", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    createDesignRulesPanel(
      container,
      [{ id: "F1", kind: "forbid", from: "a", to: "b", enabled: true }],
      { onChange },
    );
    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]![0] as DesignRule[];
    expect(next[0]!.enabled).toBe(false);
    expect(onChange.mock.calls[0]![1]).toBeUndefined();
  });
});
