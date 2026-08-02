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
});
