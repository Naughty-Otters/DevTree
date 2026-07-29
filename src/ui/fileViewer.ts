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
}

export interface FileViewerHandle {
  open: (path: string, content: string, opts?: FileViewerOpenOptions) => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createFileViewer(
  container: HTMLElement,
  onClose: () => void,
): FileViewerHandle {
  let currentPath: string | null = null;

  const header = document.createElement("div");
  header.className = "file-viewer-header";

  const title = document.createElement("span");
  title.className = "file-viewer-title";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-text file-viewer-close";
  closeBtn.textContent = "✕";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", () => {
    container.classList.add("hidden");
    currentPath = null;
    onClose();
  });

  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "file-viewer-body scrollable";

  container.append(header, body);

  return {
    open(path: string, content: string, opts?: FileViewerOpenOptions) {
      currentPath = path;
      const lang = highlightLanguage(path);
      title.textContent =
        opts?.line && opts.line > 0 ? `${path}:${opts.line}` : path;

      body.innerHTML = "";
      const table = document.createElement("table");
      table.className = "file-viewer-table";

      const lines = content.split("\n");
      let highlighted: string[] = [];
      try {
        const html = hljs.highlight(content, { language: lang }).value;
        highlighted = html.split("\n");
      } catch {
        highlighted = lines.map((l) =>
          l
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;"),
        );
      }

      const targetLine = opts?.line && opts.line > 0 ? opts.line : null;

      for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const tr = document.createElement("tr");
        tr.className = "file-viewer-line";
        tr.dataset.line = String(lineNo);
        if (targetLine === lineNo) {
          tr.classList.add("file-viewer-line-active");
        }

        const gutter = document.createElement("td");
        gutter.className = "file-viewer-gutter";
        gutter.textContent = String(lineNo);

        const codeCell = document.createElement("td");
        codeCell.className = "file-viewer-code";
        const code = document.createElement("code");
        code.className = `language-${lang}`;
        code.innerHTML = highlighted[i] ?? "";
        codeCell.appendChild(code);

        tr.append(gutter, codeCell);
        table.appendChild(tr);
      }

      body.appendChild(table);
      container.classList.remove("hidden");

      if (targetLine) {
        requestAnimationFrame(() => {
          const row = body.querySelector<HTMLElement>(
            `[data-line="${targetLine}"]`,
          );
          row?.scrollIntoView({ block: "center" });
        });
      } else {
        body.scrollTop = 0;
      }
    },
    close() {
      container.classList.add("hidden");
      currentPath = null;
    },
    isOpen: () => currentPath !== null,
  };
}
