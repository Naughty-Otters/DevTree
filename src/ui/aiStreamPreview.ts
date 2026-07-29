import type { AiValidationStream } from "../analysis/types";

export function renderAiStreamPreview(
  container: HTMLElement,
  stream: AiValidationStream,
): void {
  container.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "ai-stream-preview";

  const header = document.createElement("div");
  header.className = "ai-stream-preview-header";
  header.textContent = `${stream.ruleName} · ${stream.status === "running" ? "streaming…" : stream.status}`;

  const body = document.createElement("div");
  body.className = "ai-stream-preview-body";

  if (stream.activity) {
    const activity = document.createElement("div");
    activity.className = "ai-stream-activity";
    activity.textContent = stream.activity;
    body.appendChild(activity);
  }

  if (stream.thinking.trim()) {
    const thinkingLabel = document.createElement("div");
    thinkingLabel.className = "ai-stream-section-label";
    thinkingLabel.textContent = "Reasoning";
    const thinking = document.createElement("pre");
    thinking.className = "ai-stream-thinking";
    thinking.textContent = stream.thinking;
    body.append(thinkingLabel, thinking);
  }

  if (stream.text.trim()) {
    const textLabel = document.createElement("div");
    textLabel.className = "ai-stream-section-label";
    textLabel.textContent = "Output";
    const text = document.createElement("pre");
    text.className = "ai-stream-text";
    text.textContent = stream.text;
    body.append(textLabel, text);
  }

  if (!stream.thinking.trim() && !stream.text.trim()) {
    const waiting = document.createElement("div");
    waiting.className = "ai-stream-waiting";
    waiting.textContent = "Waiting for model response…";
    body.appendChild(waiting);
  }

  wrap.append(header, body);
  container.appendChild(wrap);

  const scrollHost = body.querySelector(".ai-stream-text") ?? body.querySelector(".ai-stream-thinking");
  if (scrollHost instanceof HTMLElement) {
    scrollHost.scrollTop = scrollHost.scrollHeight;
  }
  body.scrollTop = body.scrollHeight;
}
