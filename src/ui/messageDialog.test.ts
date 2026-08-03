import { describe, expect, it } from "vitest";
import { showMessageDialog, splitInstallReport } from "./messageDialog";

describe("splitInstallReport", () => {
  it("uses the first line as summary", () => {
    expect(splitInstallReport("Installed with brew.\n==> Downloading")).toEqual({
      summary: "Installed with brew.",
      body: "Installed with brew.\n==> Downloading",
    });
  });

  it("handles single-line messages", () => {
    expect(splitInstallReport("Already installed.")).toEqual({
      summary: "Already installed.",
      body: "Already installed.",
    });
  });
});

describe("showMessageDialog", () => {
  it("renders a fixed scroll pane and closes on OK", async () => {
    const done = showMessageDialog({
      title: "Install gitleaks",
      summary: "Installed with Homebrew.",
      body: "line1\n".repeat(200),
      tone: "success",
    });

    const dialog = document.querySelector(".modal-dialog-report");
    expect(dialog).toBeTruthy();
    const output = dialog?.querySelector(".message-dialog-output");
    expect(output?.textContent).toContain("line1");

    dialog?.querySelector<HTMLButtonElement>(".btn-primary")?.click();
    await done;
    expect(document.querySelector(".modal-dialog-report")).toBeNull();
  });
});
