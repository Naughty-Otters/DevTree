import type { AiValidationStream } from "../analysis/types";
import { t } from "../i18n";

function ensureChild(parent: HTMLElement, selector: string, tag: string, className: string): HTMLElement {
  let el = parent.querySelector<HTMLElement>(selector);
  if (!el) {
    el = document.createElement(tag);
    el.className = className;
    parent.appendChild(el);
  }
  return el;
}

const NEAR_BOTTOM_PX = 48;

const LEGACY_BODY_SECTIONS = [
  ".ai-stream-budget",
  ".ai-stream-activity",
  ".ai-stream-tools-label",
  ".ai-stream-tools",
  ".ai-stream-thinking-label",
  ".ai-stream-thinking",
  ".ai-stream-text-label",
  ".ai-stream-text",
  ".ai-stream-waiting",
] as const;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

/** Track whether the user has scrolled away from the tail (default: follow). */
function bindScrollFollow(el: HTMLElement): void {
  if (el.dataset.scrollFollowBound) {
    return;
  }
  el.dataset.scrollFollowBound = "1";
  el.addEventListener(
    "scroll",
    () => {
      el.dataset.stickToBottom = isNearBottom(el) ? "1" : "0";
    },
    { passive: true },
  );
}

function shouldFollowTail(el: HTMLElement): boolean {
  return el.dataset.stickToBottom !== "0";
}

function scrollToTail(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

function maybeScrollToTail(pane: HTMLElement, contentChanged: boolean): void {
  bindScrollFollow(pane);
  if (!contentChanged) {
    return;
  }
  if (shouldFollowTail(pane) || isNearBottom(pane)) {
    scrollToTail(pane);
  }
}

function removeLegacyBodySections(body: HTMLElement): void {
  for (const selector of LEGACY_BODY_SECTIONS) {
    body.querySelector(`:scope > ${selector}`)?.remove();
  }
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
  const statusLabel =
    stream.status === "running"
      ? t("llm.stream.streaming")
      : stream.status === "done"
        ? t("llm.stream.done")
        : t("llm.stream.failed");
  header.textContent = `${stream.ruleName} · ${statusLabel}`;

  const body = ensureChild(wrap, ".ai-stream-preview-body", "div", "ai-stream-preview-body");
  const meta = ensureChild(body, ".ai-stream-meta", "div", "ai-stream-meta");
  const panes = ensureChild(body, ".ai-stream-panes", "div", "ai-stream-panes");
  removeLegacyBodySections(body);

  if (stream.budget) {
    const budget = ensureChild(meta, ".ai-stream-budget", "div", "ai-stream-budget");
    if (budget.textContent !== stream.budget) {
      budget.textContent = stream.budget;
    }
  } else {
    meta.querySelector(".ai-stream-budget")?.remove();
  }

  if (stream.activity) {
    const activity = ensureChild(meta, ".ai-stream-activity", "div", "ai-stream-activity");
    if (activity.textContent !== stream.activity) {
      activity.textContent = stream.activity;
    }
  } else {
    meta.querySelector(".ai-stream-activity")?.remove();
  }

  const toolLog = stream.toolLog?.trim() ? stream.toolLog : "";
  if (toolLog) {
    const toolsPane = ensureChild(panes, ".ai-stream-tools-pane", "div", "ai-stream-tools-pane");
    ensureChild(toolsPane, ".ai-stream-tools-label", "div", "ai-stream-section-label ai-stream-tools-label")
      .textContent = t("llm.stream.toolOutput");
    const tools = ensureChild(toolsPane, ".ai-stream-tools", "pre", "ai-stream-tools");
    const toolsChanged = tools.textContent !== toolLog;
    if (toolsChanged) {
      tools.textContent = toolLog;
    }
    maybeScrollToTail(toolsPane, toolsChanged);
  } else {
    panes.querySelector(".ai-stream-tools-pane")?.remove();
  }

  const modelPane = ensureChild(panes, ".ai-stream-model-pane", "div", "ai-stream-model-pane");
  modelPane.querySelector(".ai-stream-waiting")?.remove();

  let modelChanged = false;

  if (stream.thinking.trim()) {
    ensureChild(modelPane, ".ai-stream-thinking-label", "div", "ai-stream-section-label ai-stream-thinking-label")
      .textContent = t("llm.stream.reasoning");
    const thinking = ensureChild(modelPane, ".ai-stream-thinking", "pre", "ai-stream-thinking");
    if (thinking.textContent !== stream.thinking) {
      thinking.textContent = stream.thinking;
      modelChanged = true;
    }
  } else {
    modelPane.querySelector(".ai-stream-thinking-label")?.remove();
    modelPane.querySelector(".ai-stream-thinking")?.remove();
  }

  if (stream.text.trim()) {
    ensureChild(modelPane, ".ai-stream-text-label", "div", "ai-stream-section-label ai-stream-text-label")
      .textContent = t("llm.stream.output");
    const text = ensureChild(modelPane, ".ai-stream-text", "pre", "ai-stream-text");
    if (text.textContent !== stream.text) {
      text.textContent = stream.text;
      modelChanged = true;
    }
  } else {
    modelPane.querySelector(".ai-stream-text-label")?.remove();
    modelPane.querySelector(".ai-stream-text")?.remove();
  }

  if (!stream.thinking.trim() && !stream.text.trim() && !stream.activity && !toolLog && !stream.budget) {
    const waiting = ensureChild(modelPane, ".ai-stream-waiting", "div", "ai-stream-waiting");
    const waitingText = t("llm.stream.waiting");
    if (waiting.textContent !== waitingText) {
      waiting.textContent = waitingText;
      modelChanged = true;
    }
  }

  maybeScrollToTail(modelPane, modelChanged);
}
