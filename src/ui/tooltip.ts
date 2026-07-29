let tipEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureTip(): HTMLElement {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "app-tooltip hidden";
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function showTip(text: string, anchor: HTMLElement): void {
  const tip = ensureTip();
  tip.textContent = text;
  tip.classList.remove("hidden");

  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.bottom + 8;

  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
  if (top + tipRect.height > window.innerHeight - 8) {
    top = rect.top - tipRect.height - 8;
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    tipEl?.classList.add("hidden");
  }, 80);
}

export function attachTooltip(el: HTMLElement, text: string): void {
  el.removeAttribute("title");
  el.dataset.tooltip = text;

  el.addEventListener("mouseenter", () => {
    if (hideTimer) clearTimeout(hideTimer);
    showTip(text, el);
  });
  el.addEventListener("mouseleave", hideTip);
  el.addEventListener("mousedown", hideTip);
}

export function initTooltips(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-tooltip]").forEach((el) => {
    const text = el.dataset.tooltip;
    if (text) attachTooltip(el, text);
  });
}
