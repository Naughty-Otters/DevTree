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

export interface FileViewerHandle {
  open: (path: string, content: string) => void;
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

  const pre = document.createElement("pre");
  pre.className = "file-viewer-pre scrollable";

  const code = document.createElement("code");
  pre.appendChild(code);

  container.append(header, pre);

  return {
    open(path: string, content: string) {
      currentPath = path;
      const lang = highlightLanguage(path);
      title.textContent = path;
      code.className = `language-${lang}`;
      try {
        code.innerHTML = hljs.highlight(content, { language: lang }).value;
      } catch {
        code.textContent = content;
      }
      container.classList.remove("hidden");
    },
    close() {
      container.classList.add("hidden");
      currentPath = null;
    },
    isOpen: () => currentPath !== null,
  };
}
