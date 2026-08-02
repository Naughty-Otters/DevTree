import { describe, expect, it, vi } from "vitest";
import { showAnalysisDialog } from "./analysisDialog";

describe("analysisDialog", () => {
  it("creates or renders without throwing", () => {
    expect(() => {
      void showAnalysisDialog(1);
    }).not.toThrow();
  });

  it("offers configure-rules when a callback is provided", async () => {
    const onConfigureRules = vi.fn();
    const promise = showAnalysisDialog(3, { onConfigureRules });
    const link = document.querySelector(
      ".run-dialog-configure-rules",
    ) as HTMLButtonElement;
    expect(link).toBeTruthy();
    expect(link.textContent).toMatch(/Configure rules/i);
    link.click();
    await expect(promise).resolves.toBeNull();
    expect(onConfigureRules).toHaveBeenCalledOnce();
  });
});
