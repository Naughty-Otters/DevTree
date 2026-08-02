export type LoadingPlaceholderSize = "inline" | "panel" | "fill";

export interface LoadingPlaceholderOptions {
  title: string;
  detail?: string;
  size?: LoadingPlaceholderSize;
}

/** Shared spinner + copy for lazy-loading views. */
export function createLoadingPlaceholder(
  options: LoadingPlaceholderOptions,
): HTMLElement {
  const size = options.size ?? "panel";
  const root = document.createElement("div");
  root.className = `loading-placeholder loading-placeholder-${size}`;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-busy", "true");

  const spinner = document.createElement("span");
  spinner.className = "loading-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const copy = document.createElement("div");
  copy.className = "loading-placeholder-copy";

  const title = document.createElement("p");
  title.className = "loading-placeholder-title";
  title.textContent = options.title;
  copy.appendChild(title);

  if (options.detail) {
    const detail = document.createElement("p");
    detail.className = "loading-placeholder-detail";
    detail.textContent = options.detail;
    copy.appendChild(detail);
  }

  root.append(spinner, copy);
  return root;
}

/** True when overlay copy is a busy/loading state (show spinner). */
export function isBusyOverlayTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return (
    t.endsWith("…") ||
    t.endsWith("...") ||
    t.includes("loading") ||
    t.includes("computing") ||
    t.includes("scanning") ||
    t.includes("restoring")
  );
}
