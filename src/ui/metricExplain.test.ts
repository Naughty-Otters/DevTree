import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachMetricDefinitionToggle,
  createMetricDefinitionPanel,
  hideMetricDefinitionPopup,
  showMetricDefinitionPopup,
} from "./metricExplain";
import { setLocale } from "../i18n";
import { openUrl } from "@tauri-apps/plugin-opener";

describe("metricExplain popup", () => {
  afterEach(() => {
    hideMetricDefinitionPopup();
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("creates definition content with formula and measured detail", () => {
    setLocale("en");
    const panel = createMetricDefinitionPanel("halstead", "Precomputed volume");
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toMatch(/Halstead/i);
    expect(panel!.textContent).toMatch(
      /How this value was measured|How it's calculated|V\s*=/i,
    );
  });

  it("shows a floating popup anchored to the metric row", async () => {
    setLocale("en");
    const list = document.createElement("div");
    const row = document.createElement("div");
    list.appendChild(row);
    document.body.appendChild(list);

    attachMetricDefinitionToggle(row, "complexity", {
      listRoot: list,
      label: "Complexity",
      displayValue: "12",
      measuredDetail: "Keyword cyclomatic estimate",
    });

    row.click();
    await Promise.resolve();

    const popup = document.querySelector<HTMLElement>(".metric-def-popup");
    expect(popup).toBeTruthy();
    expect(popup!.classList.contains("hidden")).toBe(false);
    expect(popup!.textContent).toMatch(/Complexity/);
    expect(popup!.textContent).toMatch(/12/);
    expect(popup!.textContent).toMatch(/CC\s*=/);
    expect(popup!.textContent).toMatch(/Keyword cyclomatic/);
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens learn-more via Tauri openUrl", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    setLocale("en");
    const row = document.createElement("div");
    document.body.appendChild(row);
    showMetricDefinitionPopup(row, "complexity", { label: "Complexity" });

    const btn = document.querySelector<HTMLButtonElement>(".metric-def-link");
    expect(btn).toBeTruthy();
    btn!.click();
    await vi.waitFor(() => {
      expect(openUrl).toHaveBeenCalled();
    });
    const url = vi.mocked(openUrl).mock.calls[0]![0] as string;
    expect(url).toContain("Cyclomatic_complexity");

    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });
});
