import { describe, expect, it } from "vitest";
import { renderAiStreamPreview } from "./aiStreamPreview";

describe("ui/aiStreamPreview", () => {
  it("patches stream text in place without replacing the preview root", () => {
    const host = document.createElement("div");
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "",
      text: "hello",
    });
    const first = host.querySelector(".ai-stream-preview");
    expect(first).toBeTruthy();
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "",
      text: "hello world",
    });
    expect(host.querySelector(".ai-stream-preview")).toBe(first);
    expect(host.querySelector(".ai-stream-text")?.textContent).toBe("hello world");
  });

  it("renders live tool output in a dedicated section", () => {
    const host = document.createElement("div");
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "",
      text: "",
      activity: "Running shell: pytest -q",
      toolLog: "$ pytest -q\nFAILED tests/foo.py\n",
    });
    expect(host.querySelector(".ai-stream-tools")?.textContent).toContain("FAILED tests/foo.py");
    expect(host.querySelector(".ai-stream-waiting")).toBeNull();
  });

  it("renders token budget status", () => {
    const host = document.createElement("div");
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "",
      text: "",
      budget: "Tokens 12.4k / 50k",
    });
    expect(host.querySelector(".ai-stream-budget")?.textContent).toBe("Tokens 12.4k / 50k");
    expect(host.querySelector(".ai-stream-waiting")).toBeNull();
  });
});
