import type { FileLineIssue } from "../validation/fileIssues";

export interface FileNavOptions {
  path: string;
  issues: FileLineIssue[];
  onIssueClick?: (line: number) => void;
}

/** File-view issue chips under the view tabs (path crumbs live in #breadcrumb-bar). */
export function renderFileNav(
  container: HTMLElement,
  options: FileNavOptions,
): void {
  container.innerHTML = "";

  const lineIssues = options.issues.filter(
    (i) => i.line != null && i.line > 0,
  );

  if (lineIssues.length === 0) return;

  const warn = document.createElement("div");
  warn.className = "file-nav-issues scrollable";

  for (const issue of lineIssues) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `file-nav-issue file-nav-issue-${issue.severity}`;
    btn.title = `${issue.ruleName}: ${issue.message}`;
    btn.innerHTML = `<span class="file-nav-issue-line">L${issue.line}</span><span class="file-nav-issue-msg">${escapeHtml(issue.message)}</span>`;
    btn.addEventListener("click", () => {
      if (issue.line) options.onIssueClick?.(issue.line);
    });
    warn.appendChild(btn);
  }

  container.appendChild(warn);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
