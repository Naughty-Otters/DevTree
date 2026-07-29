import { createElement } from "lucide";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileJson2,
  FileText,
  FileBraces,
  Folder,
  FolderOpen,
  Image,
} from "lucide";
import type { IconNode } from "lucide";

const ICON_SIZE = 14;
const ICON_CLASS = "lucide-icon";
type LucideIcon = IconNode;

function lucideIcon(icon: LucideIcon, attrs: Record<string, string | number> = {}): SVGElement {
  const svg = createElement(icon, {
    width: ICON_SIZE,
    height: ICON_SIZE,
    class: ICON_CLASS,
    "stroke-width": 2,
    ...attrs,
  });
  return svg;
}

export function createChevron(expanded: boolean): SVGElement {
  return lucideIcon(expanded ? ChevronDown : ChevronRight, { class: `${ICON_CLASS} tree-chevron` });
}

export function createFolderIcon(expanded: boolean): SVGElement {
  return lucideIcon(expanded ? FolderOpen : Folder, {
    class: `${ICON_CLASS} tree-folder-lucide`,
    color: "#dcb757",
  });
}

const FILE_ICON_MAP: Record<string, LucideIcon> = {
  ts: FileCode2,
  tsx: FileCode2,
  js: FileCode2,
  jsx: FileCode2,
  rs: FileBraces,
  py: FileCode2,
  go: FileCode2,
  java: FileCode2,
  json: FileJson2,
  md: FileText,
  txt: FileText,
  css: FileCode2,
  html: FileCode2,
  yaml: FileBraces,
  yml: FileBraces,
  toml: FileBraces,
  png: Image,
  jpg: Image,
  jpeg: Image,
  svg: Image,
  gif: Image,
};

const FILE_COLOR_MAP: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#d4a72c",
  jsx: "#d4a72c",
  rs: "#dea584",
  py: "#3572a5",
  json: "#8b8b3d",
  md: "#9aa4b8",
};

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function createFileIcon(name: string): SVGElement {
  const ext = fileExtension(name);
  const icon = FILE_ICON_MAP[ext] ?? File;
  const color = FILE_COLOR_MAP[ext] ?? "#9aa4b8";
  return lucideIcon(icon, { class: `${ICON_CLASS} tree-file-lucide`, color });
}

export function createModuleFolderIcon(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "tree-icon-wrap";
  wrap.appendChild(
    lucideIcon(FolderOpen, { class: `${ICON_CLASS} tree-folder-lucide`, color: "#dcb757" }),
  );
  return wrap;
}

export function createModuleFileIcon(name: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "tree-icon-wrap";
  wrap.appendChild(createFileIcon(name));
  return wrap;
}

export function highlightLanguage(filename: string): string {
  const ext = fileExtension(filename);
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    rs: "rust", py: "python", go: "go", java: "java", json: "json",
    css: "css", html: "xml", md: "markdown", toml: "ini", yaml: "yaml",
    yml: "yaml", vue: "xml", svelte: "xml", sh: "bash", sql: "sql",
  };
  return map[ext] ?? "plaintext";
}

export { lucideIcon };
