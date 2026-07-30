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
    expect(container.textContent).toContain("No design rules");
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
    createDesignRulesPanel(container, rules, { onChange: vi.fn() });
    expect(container.textContent).toContain("Layers");
    expect(container.textContent).toContain("Forbid");
    expect(container.querySelectorAll(".design-rule-card")).toHaveLength(2);
  });

  it("calls onChange when adding a forbid rule", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    createDesignRulesPanel(container, [], { onChange });
    const buttons = [...container.querySelectorAll("button")];
    const addForbid = buttons.find((b) => b.textContent?.includes("forbid"));
    expect(addForbid).toBeTruthy();
    addForbid!.click();
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]![0] as DesignRule[];
    expect(next).toHaveLength(1);
    expect(next[0]!.kind).toBe("forbid");
  });

  it("calls onSuggestLayers when suggest button clicked", () => {
    const container = document.createElement("div");
    const onSuggestLayers = vi.fn();
    createDesignRulesPanel(container, [], {
      onChange: vi.fn(),
      onSuggestLayers,
    });
    const suggest = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Suggest layers"),
    );
    suggest!.click();
    expect(onSuggestLayers).toHaveBeenCalled();
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
    expect(onChange).toHaveBeenCalledWith([]);
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
  });
});
