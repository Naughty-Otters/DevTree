import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import rust from "highlight.js/lib/languages/rust";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import ini from "highlight.js/lib/languages/ini";
import "highlight.js/styles/github-dark.css";
import { highlightLanguage } from "./icons";
import type { FileLineIssue } from "../validation/fileIssues";
import { issuesByLine } from "../validation/fileIssues";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("python", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("ini", ini);

export interface FileViewerOpenOptions {
  line?: number;
  issues?: FileLineIssue[];
}

export interface FileViewerCallbacks {
  onSave?: (path: string, content: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  saveButton?: HTMLButtonElement;
}

export interface FileViewerHandle {
  open: (path: string, content: string, opts?: FileViewerOpenOptions) => void;
  close: () => void;
  isOpen: () => boolean;
  getPath: () => string | null;
  getIssues: () => FileLineIssue[];
  scrollToLine: (line: number) => void;
  save: () => Promise<void>;
  isDirty: () => boolean;
}

const LINE_HEIGHT_PX = 19;
const EDITOR_PAD_TOP = 8;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function createFileViewer(
  container: HTMLElement,
  onClose: () => void,
  callbacks: FileViewerCallbacks = {},
): FileViewerHandle {
  let currentPath: string | null = null;
  let savedContent = "";
  let currentIssues: FileLineIssue[] = [];
  let activeLine: number | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;

  const header = document.createElement("div");
  header.className = "file-viewer-header";

  const title = document.createElement("span");
  title.className = "file-viewer-title";

  const headerActions = document.createElement("div");
  headerActions.className = "file-viewer-header-actions";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-text file-viewer-close";
  closeBtn.textContent = "✕";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", () => {
    if (isDirty() && !confirm("Discard unsaved changes?")) {
      return;
    }
    close();
    onClose();
  });

  headerActions.append(closeBtn);
  header.append(title, headerActions);

  const editorWrap = document.createElement("div");
  editorWrap.className = "file-viewer-editor-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "file-viewer-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const rowsEl = document.createElement("div");
  rowsEl.className = "file-viewer-rows";
  backdrop.appendChild(rowsEl);

  const textarea = document.createElement("textarea");
  textarea.className = "file-viewer-textarea";
  textarea.spellcheck = false;
  textarea.wrap = "off";
  textarea.autocomplete = "off";
  textarea.autocapitalize = "off";

  editorWrap.append(backdrop, textarea);
  container.append(header, editorWrap);

  function isDirty(): boolean {
    return currentPath != null && textarea.value !== savedContent;
  }

  function updateSaveButton(disabled: boolean): void {
    if (callbacks.saveButton) {
      callbacks.saveButton.disabled = disabled;
    }
  }

  function setDirty(dirty: boolean): void {
    updateSaveButton(!dirty || currentPath == null);
    title.classList.toggle("file-viewer-title-dirty", dirty);
    callbacks.onDirtyChange?.(dirty);
  }

  function close(): void {
    container.classList.add("hidden");
    currentPath = null;
    savedContent = "";
    currentIssues = [];
    activeLine = null;
    textarea.value = "";
    rowsEl.innerHTML = "";
    rowsEl.style.transform = "";
    if (highlightTimer) clearTimeout(highlightTimer);
    setDirty(false);
  }

  function lineIssueSeverity(line: number): FileLineIssue["severity"] | null {
    const map = issuesByLine(currentIssues);
    const list = map.get(line);
    if (!list?.length) return null;
    if (list.some((i) => i.severity === "error")) return "error";
    if (list.some((i) => i.severity === "warning")) return "warning";
    return "info";
  }

  function highlightLines(content: string, lang: string): string[] {
    const lines = content.split("\n");
    if (lines.length === 0) return [""];
    try {
      const html = hljs.highlight(content, { language: lang }).value;
      const parts = html.split("\n");
      while (parts.length < lines.length) parts.push("");
      return parts.slice(0, lines.length);
    } catch {
      return lines.map((l) => escapeHtml(l));
    }
  }

  function renderEditor(): void {
    const lines = textarea.value.split("\n");
    const lineCount = Math.max(1, lines.length);
    const lang = highlightLanguage(currentPath ?? "");
    const highlighted = highlightLines(textarea.value, lang);

    rowsEl.innerHTML = "";

    for (let i = 0; i < lineCount; i++) {
      const lineNo = i + 1;
      const sev = lineIssueSeverity(lineNo);

      const row = document.createElement("div");
      row.className = "file-viewer-row";
      row.dataset.line = String(lineNo);

      const gutterLine = document.createElement("div");
      gutterLine.className = "file-viewer-gutter-line";
      if (sev) gutterLine.classList.add(`file-viewer-gutter-line-${sev}`);
      if (activeLine === lineNo) gutterLine.classList.add("file-viewer-gutter-active");
      gutterLine.textContent = String(lineNo);

      const codeLine = document.createElement("div");
      codeLine.className = "file-viewer-code-line hljs";
      if (sev) codeLine.classList.add(`file-viewer-code-line-${sev}`);
      if (activeLine === lineNo) codeLine.classList.add("file-viewer-code-line-active");
      codeLine.innerHTML = highlighted[i] || "\u00a0";

      row.append(gutterLine, codeLine);
      rowsEl.appendChild(row);
    }
  }

  function syncScroll(): void {
    rowsEl.style.transform = `translateY(-${textarea.scrollTop}px)`;
  }

  function scrollToLine(line: number): void {
    if (line < 1) return;
    activeLine = line;
    renderEditor();
    const lineTop = EDITOR_PAD_TOP + (line - 1) * LINE_HEIGHT_PX;
    textarea.scrollTop = Math.max(0, lineTop - editorWrap.clientHeight / 2);
    syncScroll();
  }

  function scheduleRender(): void {
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightTimer = null;
      renderEditor();
      syncScroll();
    }, 80);
  }

  function updateFromInput(): void {
    scheduleRender();
    setDirty(isDirty());
  }

  textarea.addEventListener("input", updateFromInput);
  textarea.addEventListener("scroll", syncScroll);

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value =
        textarea.value.slice(0, start) + "  " + textarea.value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      updateFromInput();
    }
  });

  async function save(): Promise<void> {
    if (!currentPath || !callbacks.onSave || !isDirty()) return;
    updateSaveButton(true);
    try {
      await callbacks.onSave(currentPath, textarea.value);
      savedContent = textarea.value;
      setDirty(false);
    } finally {
      updateSaveButton(!isDirty() || currentPath == null);
    }
  }

  if (callbacks.saveButton) {
    callbacks.saveButton.addEventListener("click", () => {
      void save();
    });
  }

  return {
    open(path: string, content: string, opts?: FileViewerOpenOptions) {
      currentPath = path;
      savedContent = content;
      currentIssues = opts?.issues ?? [];
      activeLine = opts?.line && opts.line > 0 ? opts.line : null;

      title.textContent = path;
      textarea.value = content;
      renderEditor();
      setDirty(false);

      container.classList.remove("hidden");

      if (activeLine) {
        requestAnimationFrame(() => scrollToLine(activeLine!));
      } else {
        textarea.scrollTop = 0;
        syncScroll();
      }
    },
    close,
    isOpen: () => currentPath !== null,
    getPath: () => currentPath,
    getIssues: () => currentIssues,
    scrollToLine,
    save,
    isDirty,
  };
}
