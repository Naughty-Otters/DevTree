import { en, type MessageCatalog, type MessageKey } from "./en";
import { zhCN } from "./zh-CN";

export type Locale = "en" | "zh-CN";

export type { MessageKey, MessageCatalog };
export { en, zhCN };

const CATALOGS: Record<Locale, MessageCatalog> = {
  en,
  "zh-CN": zhCN,
};

const LOCALE_STORAGE_KEY = "devtree-ui-locale";

let currentLocale: Locale = "en";
const listeners = new Set<(locale: Locale) => void>();

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function parseLocale(value: unknown, fallback: Locale = "en"): Locale {
  return isLocale(value) ? value : fallback;
}

/** Detect browser language; defaults to English. */
export function detectBrowserLocale(): Locale {
  try {
    const langs = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const lang of langs) {
      const lower = lang.toLowerCase();
      if (lower === "zh" || lower.startsWith("zh-")) return "zh-CN";
    }
  } catch {
    /* ignore */
  }
  return "en";
}

export function getLocale(): Locale {
  return currentLocale;
}

export function getLocaleTag(): string {
  return currentLocale === "zh-CN" ? "zh-CN" : "en";
}

export function setLocale(locale: Locale): void {
  if (currentLocale === locale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = getLocaleTag();
  for (const listener of listeners) {
    try {
      listener(locale);
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Initialize locale before first UI paint. Persisted value wins over browser. */
export function initLocale(persisted?: unknown): Locale {
  let locale = parseLocale(persisted, detectBrowserLocale());
  if (persisted == null) {
    try {
      const cached = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(cached)) locale = cached;
    } catch {
      /* ignore */
    }
  }
  currentLocale = locale;
  document.documentElement.lang = getLocaleTag();
  return locale;
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const catalog = CATALOGS[currentLocale] ?? en;
  let text = catalog[key] ?? en[key] ?? String(key);
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/**
 * Apply translations to elements marked with data-i18n / data-i18n-*.
 * - data-i18n="key" → textContent
 * - data-i18n-title="key" → title
 * - data-i18n-aria="key" → aria-label
 * - data-i18n-tooltip="key" → data-tooltip
 */
export function applyDomTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n as MessageKey | undefined;
    if (!key) return;
    el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml as MessageKey | undefined;
    if (!key) return;
    el.innerHTML = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle as MessageKey | undefined;
    if (!key) return;
    el.title = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    const key = el.dataset.i18nAria as MessageKey | undefined;
    if (!key) return;
    el.setAttribute("aria-label", t(key));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-tooltip]").forEach((el) => {
    const key = el.dataset.i18nTooltip as MessageKey | undefined;
    if (!key) return;
    el.dataset.tooltip = t(key);
  });
}

/** Locale options for the settings UI. */
export const LOCALE_OPTIONS: { id: Locale; labelKey: MessageKey }[] = [
  { id: "en", labelKey: "language.option.en" },
  { id: "zh-CN", labelKey: "language.option.zhCN" },
];
