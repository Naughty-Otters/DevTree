import { t } from "../i18n";

export interface MessageDialogOptions {
  title: string;
  /** Short summary above the scrollable body. */
  summary?: string;
  /** Long text shown in a fixed-height scroll pane (install logs, etc.). */
  body: string;
  /** Dialog tone for title styling. */
  tone?: "info" | "success" | "error";
  okLabel?: string;
}

/**
 * Modal with a fixed max size and scrollable body — safe for long install logs
 * that would overflow a native `alert()`.
 */
export function showMessageDialog(
  options: MessageDialogOptions,
): Promise<void> {
  const { title, summary, body, tone = "info", okLabel = t("dialog.ok") } =
    options;

  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog modal-dialog-report";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "message-dialog-title");

    const heading = document.createElement("h2");
    heading.id = "message-dialog-title";
    heading.className = `modal-title message-dialog-title message-dialog-title-${tone}`;
    heading.textContent = title;

    dialog.appendChild(heading);

    if (summary) {
      const sub = document.createElement("p");
      sub.className = "modal-subtitle";
      sub.textContent = summary;
      dialog.appendChild(sub);
    }

    const scroll = document.createElement("pre");
    scroll.className = "message-dialog-output";
    scroll.textContent = body;
    scroll.tabIndex = 0;
    dialog.appendChild(scroll);

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn btn-primary";
    ok.textContent = okLabel;
    actions.appendChild(ok);
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function close(): void {
      window.removeEventListener("keydown", onKey);
      backdrop.remove();
      document.body.style.overflow = previousOverflow;
      resolve();
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        close();
      }
    }

    ok.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    window.addEventListener("keydown", onKey);
    ok.focus();
  });
}

/** Split a multi-line install report into a short summary + scrollable log. */
export function splitInstallReport(message: string): {
  summary: string;
  body: string;
} {
  const trimmed = message.trim();
  if (!trimmed) {
    return { summary: "", body: "" };
  }
  const nl = trimmed.indexOf("\n");
  if (nl < 0) {
    return { summary: trimmed, body: trimmed };
  }
  return {
    summary: trimmed.slice(0, nl).trim(),
    body: trimmed,
  };
}
