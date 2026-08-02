import { describe, expect, it, vi } from "vitest";
import { createLlmRuntimeSettingsPanel } from "./llmRuntimeSettingsPanel";

describe("llmRuntimeSettingsPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() =>
      createLlmRuntimeSettingsPanel(container, { onChange: () => {} }),
    ).not.toThrow();
    expect(container).toBeDefined();
  });

  it("exposes turn and token budget fields and notifies onChange", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    const panel = createLlmRuntimeSettingsPanel(container, { onChange });
    panel.setSettings({ maxTurns: 96, agentMaxTurns: 48, maxTokens: 25_000 });

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=number]"));
    expect(inputs).toHaveLength(3);
    expect(inputs.map((el) => el.value)).toEqual(["96", "25000", "48"]);

    const tokenInput = inputs[1]!;
    tokenInput.value = "40000";
    tokenInput.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as { maxTokens: number };
    expect(last.maxTokens).toBe(40_000);
  });
});
