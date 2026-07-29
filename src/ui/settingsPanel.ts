import { lucideIcon } from "./icons";
import { ChevronDown, X } from "lucide";

export interface SettingsPanelApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

export function createSettingsPanel(
  root: HTMLElement,
  onOpen?: () => void,
): SettingsPanelApi {
  let open = false;

  const backdrop = root.querySelector<HTMLElement>(".settings-backdrop");
  const closeBtn = root.querySelector<HTMLButtonElement>("#btn-close-settings");
  const accordion = root.querySelector<HTMLElement>(".settings-accordion");

  function setOpen(next: boolean): void {
    open = next;
    root.classList.toggle("hidden", !open);
    root.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.classList.toggle("settings-open", open);
    if (open) onOpen?.();
  }

  backdrop?.addEventListener("click", () => setOpen(false));
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

  for (const item of items) {
    const trigger = item.querySelector<HTMLButtonElement>(
      ".settings-accordion-trigger",
    );
    const chevron = trigger?.querySelector(".settings-accordion-chevron");
    if (chevron && chevron.childElementCount === 0) {
      chevron.appendChild(
        lucideIcon(ChevronDown, {
          size: 14,
          class: "lucide-icon",
          "stroke-width": 1.75,
        }),
      );
    }

    trigger?.addEventListener("click", () => {
      // Exclusive accordion: always keep exactly one section open.
      if (item.classList.contains("is-open")) return;
      for (const other of items) {
        const open = other === item;
        other.classList.toggle("is-open", open);
        other
          .querySelector(".settings-accordion-trigger")
          ?.setAttribute("aria-expanded", open ? "true" : "false");
      }
    });
  }
}
