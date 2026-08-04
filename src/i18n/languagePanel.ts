import { t, getLocale, setLocale, LOCALE_OPTIONS, type Locale } from "./index";

export interface LanguagePanelApi {
  render: () => void;
  getLocale: () => Locale;
}

export function createLanguagePanel(
  root: HTMLElement,
  onChange: (locale: Locale) => void,
): LanguagePanelApi {
  function render(): void {
    root.replaceChildren();
    root.className = "panel-body scrollable language-panel";

    const title = document.createElement("h4");
    title.className = "language-panel-title";
    title.textContent = t("language.title");
    root.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "language-panel-desc";
    desc.textContent = t("language.description");
    root.appendChild(desc);

    const list = document.createElement("div");
    list.className = "language-option-list";
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-label", t("language.title"));

    const current = getLocale();
    for (const opt of LOCALE_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "language-option";
      btn.classList.toggle("is-active", opt.id === current);
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", opt.id === current ? "true" : "false");
      btn.textContent = t(opt.labelKey);
      btn.addEventListener("click", () => {
        if (opt.id === getLocale()) return;
        setLocale(opt.id);
        onChange(opt.id);
        render();
      });
      list.appendChild(btn);
    }
    root.appendChild(list);
  }

  render();
  return {
    render,
    getLocale,
  };
}
