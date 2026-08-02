import type { AiValidationStream } from "../analysis/types";

function ensureChild(parent: HTMLElement, selector: string, tag: string, className: string): HTMLElement {
  let el = parent.querySelector<HTMLElement>(selector);
  if (!el) {
    el = document.createElement(tag);
    el.className = className;
    parent.appendChild(el);
  }
  return el;
}

/**
 * Patch AI stream UI in place so progress ticks don't rebuild the DOM
 * (full rebuilds were resetting the Progress tab scroll position).
 */
export function renderAiStreamPreview(
  container: HTMLElement,
  stream: AiValidationStream,
): void {
  let wrap =
    container.firstElementChild instanceof HTMLElement &&
    container.firstElementChild.classList.contains("ai-stream-preview")
      ? container.firstElementChild
      : null;
  if (!wrap) {
    container.replaceChildren();
    wrap = document.createElement("div");
    wrap.className = "ai-stream-preview";
    container.appendChild(wrap);
  }

  const header = ensureChild(wrap, ".ai-stream-preview-header", "div", "ai-stream-preview-header");
  header.textContent = `${stream.ruleName} · ${stream.status === "running" ? "streaming…" : stream.status}`;

  const body = ensureChild(wrap, ".ai-stream-preview-body", "div", "ai-stream-preview-body");
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 48;

  body.querySelector(".ai-stream-waiting")?.remove();

  if (stream.activity) {
    const activity = ensureChild(body, ".ai-stream-activity", "div", "ai-stream-activity");
    if (activity.textContent !== stream.activity) {
      activity.textContent = stream.activity;
    }
  } else {
    body.querySelector(".ai-stream-activity")?.remove();
  }

  if (stream.thinking.trim()) {
    ensureChild(body, ".ai-stream-thinking-label", "div", "ai-stream-section-label ai-stream-thinking-label")
      .textContent = "Reasoning";
    const thinking = ensureChild(body, ".ai-stream-thinking", "pre", "ai-stream-thinking");
    if (thinking.textContent !== stream.thinking) {
      thinking.textContent = stream.thinking;
    }
  } else {
    body.querySelector(".ai-stream-thinking-label")?.remove();
    body.querySelector(".ai-stream-thinking")?.remove();
  }

  if (stream.text.trim()) {
    ensureChild(body, ".ai-stream-text-label", "div", "ai-stream-section-label ai-stream-text-label")
      .textContent = "Output";
    const text = ensureChild(body, ".ai-stream-text", "pre", "ai-stream-text");
    if (text.textContent !== stream.text) {
      text.textContent = stream.text;
    }
  } else {
    body.querySelector(".ai-stream-text-label")?.remove();
    body.querySelector(".ai-stream-text")?.remove();
  }

  if (!stream.thinking.trim() && !stream.text.trim()) {
    const waiting = ensureChild(body, ".ai-stream-waiting", "div", "ai-stream-waiting");
    waiting.textContent = "Waiting for model response…";
  }

  if (nearBottom) {
    body.scrollTop = body.scrollHeight;
  }
}
