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

  it("keeps tool output and model output in separate scroll panes", () => {
    const host = document.createElement("div");
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "checking imports",
      text: "looks good",
      toolLog: "$ ls\nfoo\nbar\n",
    });

    const toolsPane = host.querySelector(".ai-stream-tools-pane");
    const modelPane = host.querySelector(".ai-stream-model-pane");
    expect(toolsPane).toBeTruthy();
    expect(modelPane).toBeTruthy();
    expect(toolsPane?.querySelector(".ai-stream-tools")?.textContent).toContain("foo");
    expect(modelPane?.querySelector(".ai-stream-thinking")?.textContent).toBe("checking imports");
    expect(modelPane?.querySelector(".ai-stream-text")?.textContent).toBe("looks good");
  });

  it("follows tool output tail while streaming", () => {
    const host = document.createElement("div");
    const longOutput = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");

    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "",
      text: "",
      toolLog: longOutput,
    });

    const toolsPane = host.querySelector<HTMLElement>(".ai-stream-tools-pane");
    expect(toolsPane).toBeTruthy();

    Object.defineProperty(toolsPane!, "clientHeight", { value: 80, configurable: true });
    Object.defineProperty(toolsPane!, "scrollHeight", { value: 400, configurable: true });
    toolsPane!.scrollTop = 0;

    const extended = `${longOutput}\nline 40\nline 41`;
    Object.defineProperty(toolsPane!, "scrollHeight", { value: 440, configurable: true });
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "",
      text: "",
      toolLog: extended,
    });
    expect(toolsPane!.scrollTop).toBe(440);
  });

  it("stops following tool tail after user scrolls up", () => {
    const host = document.createElement("div");
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "",
      text: "",
      toolLog: "line 1\n",
    });

    const toolsPane = host.querySelector<HTMLElement>(".ai-stream-tools-pane");
    expect(toolsPane).toBeTruthy();

    Object.defineProperty(toolsPane!, "clientHeight", { value: 80, configurable: true });
    Object.defineProperty(toolsPane!, "scrollHeight", { value: 400, configurable: true });
    toolsPane!.scrollTop = 0;
    toolsPane!.dispatchEvent(new Event("scroll"));

    Object.defineProperty(toolsPane!, "scrollHeight", { value: 440, configurable: true });
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "",
      text: "",
      toolLog: "line 1\nline 2\n",
    });
    expect(toolsPane!.scrollTop).toBe(0);
  });

  it("follows model output tail independently of tool output", () => {
    const host = document.createElement("div");
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "step 1",
      text: "",
      toolLog: "$ echo hi\nhi\n",
    });

    const toolsPane = host.querySelector<HTMLElement>(".ai-stream-tools-pane");
    const modelPane = host.querySelector<HTMLElement>(".ai-stream-model-pane");
    expect(toolsPane).toBeTruthy();
    expect(modelPane).toBeTruthy();

    Object.defineProperty(modelPane!, "clientHeight", { value: 80, configurable: true });
    Object.defineProperty(modelPane!, "scrollHeight", { value: 200, configurable: true });
    modelPane!.scrollTop = 0;

    Object.defineProperty(modelPane!, "scrollHeight", { value: 260, configurable: true });
    renderAiStreamPreview(host, {
      ruleId: "ai",
      ruleName: "AI review",
      status: "running",
      thinking: "step 1\nstep 2\nstep 3",
      text: "",
      toolLog: "$ echo hi\nhi\n",
    });

    expect(modelPane!.scrollTop).toBe(260);
    expect(toolsPane!.scrollTop).toBe(0);
  });
});
