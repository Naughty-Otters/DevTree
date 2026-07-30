import { lucideIcon } from "./icons";
import { ChevronDown, X } from "lucide";

export interface SettingsPanelApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

export interface SettingsPanelOptions {
  onOpen?: () => void;
  onToggle?: (open: boolean) => void;
  initiallyOpen?: boolean;
}

export function createSettingsPanel(
  root: HTMLElement,
  onOpenOrOptions?: (() => void) | SettingsPanelOptions,
): SettingsPanelApi {
  const options: SettingsPanelOptions =
    typeof onOpenOrOptions === "function"
      ? { onOpen: onOpenOrOptions }
      : (onOpenOrOptions ?? {});

  let open = Boolean(options.initiallyOpen);
  const closeBtn = root.querySelector<HTMLButtonElement>("#btn-close-settings");
  const accordion = root.querySelector<HTMLElement>(".settings-accordion");
  const resizeHandle = document.querySelector<HTMLElement>("#right-resize-handle");

  function applyOpen(next: boolean): void {
    open = next;
    root.classList.toggle("hidden", !open);
    root.setAttribute("aria-hidden", open ? "false" : "true");
    resizeHandle?.classList.toggle("hidden", !open);
    document.body.classList.toggle("settings-open", open);
    document
      .querySelector("#btn-settings")
      ?.classList.toggle("is-active", open);
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    applyOpen(next);
    options.onToggle?.(open);
    if (open) options.onOpen?.();
  }

  closeBtn?.addEventListener("click", () => setOpen(false));

  if (closeBtn && closeBtn.childElementCount === 0) {
    closeBtn.appendChild(
      lucideIcon(X, {
        size: 14,
        class: "lucide-icon",
        "stroke-width": 1.75,
      }),
    );
  }

  initSettingsAccordion(accordion);
  applyOpen(open);
  if (open) {
    options.onOpen?.();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      setOpen(false);
    }
  });

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    isOpen: () => open,
  };
}

function initSettingsAccordion(root: HTMLElement | null): void {
  if (!root) return;

  const items = [
    ...root.querySelectorAll<HTMLElement>(".settings-accordion-item"),
  ];

  function setItemOpen(item: HTMLElement, open: boolean): void {
    item.classList.toggle("is-open", open);
    item
      .querySelector(".settings-accordion-expand")
      ?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  for (const item of items) {
    const expandBtn = item.querySelector<HTMLButtonElement>(
      ".settings-accordion-expand",
    );
    const chevron = expandBtn?.querySelector(".settings-accordion-chevron");
    if (chevron && chevron.childElementCount === 0) {
      chevron.appendChild(
        lucideIcon(ChevronDown, {
          size: 14,
          class: "lucide-icon",
          "stroke-width": 1.75,
        }),
      );
    }

    // Expand/collapse only via the chevron button — not the label.
    expandBtn?.addEventListener("click", () => {
      const willOpen = !item.classList.contains("is-open");
      for (const other of items) {
        setItemOpen(other, willOpen && other === item);
      }
    });
  }
}
