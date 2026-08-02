import { isBusyOverlayTitle } from "./loadingPlaceholder";

export interface FlowOverlayAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface FlowOverlayContent {
  title: string;
  detail?: string;
  actions?: FlowOverlayAction[];
  /** Force spinner; defaults to auto-detect from title. */
  loading?: boolean;
}

/**
 * Renders a centered flow card into the graph overlay host.
 * With actions, the overlay becomes interactive; otherwise it stays pass-through.
 */
export function renderFlowOverlay(
  root: HTMLElement,
  content: FlowOverlayContent,
): void {
  root.classList.remove("hidden");
  root.replaceChildren();

  const card = document.createElement("div");
  card.className = "flow-overlay-card";
  const busy =
    content.loading === true ||
    (content.loading !== false &&
      !content.actions?.length &&
      isBusyOverlayTitle(content.title));
  if (busy) {
    card.classList.add("is-loading");
    const spinner = document.createElement("span");
    spinner.className = "loading-spinner";
    spinner.setAttribute("aria-hidden", "true");
    card.appendChild(spinner);
    // Keep a11y status without nesting another full placeholder block.
    card.setAttribute("role", "status");
    card.setAttribute("aria-busy", "true");
    card.setAttribute("aria-live", "polite");
  }

  const title = document.createElement("p");
  title.className = "flow-overlay-title";
  title.textContent = content.title;
  card.appendChild(title);

  if (content.detail) {
    const detail = document.createElement("p");
    detail.className = "flow-overlay-detail";
    detail.textContent = content.detail;
    card.appendChild(detail);
  }

  const actions = content.actions ?? [];
  if (actions.length > 0) {
    root.classList.add("flow-overlay-interactive");
    const row = document.createElement("div");
    row.className = "flow-overlay-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = action.primary ? "btn btn-primary" : "btn btn-ghost";
      btn.textContent = action.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action.onClick();
      });
      row.appendChild(btn);
    }
    card.appendChild(row);
  } else {
    root.classList.remove("flow-overlay-interactive");
  }

  root.appendChild(card);
}

export function hideFlowOverlay(root: HTMLElement): void {
  root.classList.add("hidden");
  root.classList.remove("flow-overlay-interactive");
  root.replaceChildren();
}
