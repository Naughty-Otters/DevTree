import { t, type MessageKey } from "../i18n";

export type AnalysisRunMode = "now" | "watch" | "schedule";

export interface AnalysisRunChoice {
  mode: AnalysisRunMode;
  /** Debounce for file-watch mode (ms). */
  debounceMs: number;
  /** Cron expression for schedule mode (5-field). */
  cron: string;
  /** When enabling watch/schedule, also kick off one run immediately. */
  runImmediately: boolean;
}

export const DEFAULT_WATCH_DEBOUNCE_MS = 3000;

/** Debounce presets for file-watch mode (milliseconds). */
export const WATCH_DEBOUNCE_OPTIONS_MS = [
  1_000,
  2_000,
  3_000,
  5_000,
  10_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
] as const;

export function formatWatchDebounceMs(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const mins = ms / 60_000;
    return mins === 1
      ? t("analysis.debounceMin")
      : t("analysis.debounceMins", { n: mins });
  }
  if (ms >= 1_000 && ms % 1_000 === 0) {
    return t("analysis.debounceSecs", { n: ms / 1_000 });
  }
  return t("analysis.debounceMs", { n: ms });
}

export const CRON_PRESETS: { labelKey: MessageKey; value: string }[] = [
  { labelKey: "analysis.cron.every15", value: "*/15 * * * *" },
  { labelKey: "analysis.cron.every30", value: "*/30 * * * *" },
  { labelKey: "analysis.cron.everyHour", value: "0 * * * *" },
  { labelKey: "analysis.cron.everyDay9", value: "0 9 * * *" },
  { labelKey: "analysis.cron.weekdays9", value: "0 9 * * 1-5" },
];

export interface AnalysisDialogOptions {
  defaults?: Partial<AnalysisRunChoice>;
  /** Open Settings → Analysis Rules (closes the dialog first). */
  onConfigureRules?: () => void;
}

export function showAnalysisDialog(
  ruleCount: number,
  defaultsOrOptions?: Partial<AnalysisRunChoice> | AnalysisDialogOptions,
): Promise<AnalysisRunChoice | null> {
  const options: AnalysisDialogOptions =
    defaultsOrOptions &&
    ("defaults" in defaultsOrOptions || "onConfigureRules" in defaultsOrOptions)
      ? (defaultsOrOptions as AnalysisDialogOptions)
      : { defaults: defaultsOrOptions as Partial<AnalysisRunChoice> | undefined };
  const defaults = options.defaults;

  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog modal-dialog-wide";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-labelledby", "analysis-dialog-title");

    const title = document.createElement("h2");
    title.id = "analysis-dialog-title";
    title.className = "modal-title";
    title.textContent = t("analysis.runTitle");

    const subtitle = document.createElement("p");
    subtitle.className = "modal-subtitle";
    subtitle.textContent =
      ruleCount === 0
        ? t("analysis.noRules")
        : ruleCount === 1
          ? t("analysis.rulesSelectedOne")
          : t("analysis.rulesSelected", { count: ruleCount });

    const rulesRow = document.createElement("p");
    rulesRow.className = "run-dialog-rules-row";
    if (options.onConfigureRules) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "btn-text run-dialog-configure-rules";
      link.textContent = t("analysis.configureRules");
      link.addEventListener("click", () => {
        close(null);
        options.onConfigureRules?.();
      });
      rulesRow.appendChild(link);
    } else {
      rulesRow.hidden = true;
    }

    const body = document.createElement("div");
    body.className = "modal-body run-mode-body";

    let mode: AnalysisRunMode = defaults?.mode ?? "now";
    let debounceMs = defaults?.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
    let cron = defaults?.cron ?? CRON_PRESETS[2]!.value;
    let runImmediately = defaults?.runImmediately ?? true;

    const modes: {
      id: AnalysisRunMode;
      titleKey: MessageKey;
      descKey: MessageKey;
    }[] = [
      {
        id: "now",
        titleKey: "analysis.runNow",
        descKey: "analysis.runNowDesc",
      },
      {
        id: "watch",
        titleKey: "analysis.onFileChanges",
        descKey: "analysis.onFileChangesDesc",
      },
      {
        id: "schedule",
        titleKey: "analysis.onSchedule",
        descKey: "analysis.onScheduleDesc",
      },
    ];

    const optionEls: HTMLElement[] = [];
    const watchOptions = document.createElement("div");
    watchOptions.className = "run-mode-options";
    const scheduleOptions = document.createElement("div");
    scheduleOptions.className = "run-mode-options";
    const sharedOptions = document.createElement("div");
    sharedOptions.className = "run-mode-options";

    function syncOptionsVisibility(): void {
      watchOptions.classList.toggle("hidden", mode !== "watch");
      scheduleOptions.classList.toggle("hidden", mode !== "schedule");
      sharedOptions.classList.toggle("hidden", mode === "now");
      for (const el of optionEls) {
        el.classList.toggle("is-selected", el.dataset.mode === mode);
      }
    }

    for (const item of modes) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "run-mode-card";
      card.dataset.mode = item.id;
      const cardTitle = document.createElement("span");
      cardTitle.className = "run-mode-card-title";
      cardTitle.textContent = t(item.titleKey);
      const cardDesc = document.createElement("span");
      cardDesc.className = "run-mode-card-desc";
      cardDesc.textContent = t(item.descKey);
      card.append(cardTitle, cardDesc);
      card.addEventListener("click", () => {
        mode = item.id;
        syncOptionsVisibility();
      });
      optionEls.push(card);
      body.appendChild(card);
    }

    // Watch options
    const debounceLabel = document.createElement("label");
    debounceLabel.className = "run-mode-field";
    const debounceSpan = document.createElement("span");
    debounceSpan.textContent = t("analysis.debounce");
    debounceLabel.appendChild(debounceSpan);
    const debounceSelect = document.createElement("select");
    debounceSelect.className = "run-mode-select";
    const debounceOptions: number[] = [...WATCH_DEBOUNCE_OPTIONS_MS];
    if (!debounceOptions.includes(debounceMs)) {
      debounceOptions.push(debounceMs);
      debounceOptions.sort((a, b) => a - b);
    }
    for (const ms of debounceOptions) {
      const opt = document.createElement("option");
      opt.value = String(ms);
      opt.textContent = formatWatchDebounceMs(ms);
      if (ms === debounceMs) opt.selected = true;
      debounceSelect.appendChild(opt);
    }
    debounceSelect.addEventListener("change", () => {
      debounceMs = Number(debounceSelect.value) || DEFAULT_WATCH_DEBOUNCE_MS;
    });
    debounceLabel.appendChild(debounceSelect);
    watchOptions.appendChild(debounceLabel);

    // Schedule options
    const cronLabel = document.createElement("label");
    cronLabel.className = "run-mode-field";
    const cronSpan = document.createElement("span");
    cronSpan.textContent = t("analysis.schedule");
    cronLabel.appendChild(cronSpan);
    const cronSelect = document.createElement("select");
    cronSelect.className = "run-mode-select";
    for (const preset of CRON_PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset.value;
      opt.textContent = t(preset.labelKey);
      if (preset.value === cron) opt.selected = true;
      cronSelect.appendChild(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = "__custom__";
    customOpt.textContent = t("analysis.customCron");
    cronSelect.appendChild(customOpt);

    const cronInput = document.createElement("input");
    cronInput.type = "text";
    cronInput.className = "run-mode-input";
    cronInput.placeholder = t("analysis.cronPlaceholder");
    cronInput.value = cron;
    cronInput.classList.add("hidden");

    cronSelect.addEventListener("change", () => {
      if (cronSelect.value === "__custom__") {
        cronInput.classList.remove("hidden");
        cron = cronInput.value.trim() || cron;
      } else {
        cronInput.classList.add("hidden");
        cron = cronSelect.value;
        cronInput.value = cron;
      }
    });
    cronInput.addEventListener("change", () => {
      cron = cronInput.value.trim();
    });

    cronLabel.append(cronSelect, cronInput);
    scheduleOptions.appendChild(cronLabel);

    const cronHint = document.createElement("p");
    cronHint.className = "run-mode-hint";
    cronHint.textContent = t("analysis.cronHint");
    scheduleOptions.appendChild(cronHint);

    // Shared: run immediately
    const immediateLabel = document.createElement("label");
    immediateLabel.className = "run-mode-check";
    const immediateInput = document.createElement("input");
    immediateInput.type = "checkbox";
    immediateInput.checked = runImmediately;
    immediateInput.addEventListener("change", () => {
      runImmediately = immediateInput.checked;
    });
    const immediateText = document.createElement("span");
    immediateText.textContent = t("analysis.runImmediately");
    immediateLabel.append(immediateInput, immediateText);
    sharedOptions.appendChild(immediateLabel);

    body.append(watchOptions, scheduleOptions, sharedOptions);
    syncOptionsVisibility();

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-ghost-modal";
    cancelBtn.textContent = t("analysis.cancel");

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "btn btn-primary";
    startBtn.textContent = t("analysis.start");

    actions.append(cancelBtn, startBtn);
    dialog.append(title, subtitle, rulesRow, body, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    function close(result: AnalysisRunChoice | null): void {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter") {
        e.preventDefault();
        startBtn.click();
      }
    };

    cancelBtn.addEventListener("click", () => close(null));
    startBtn.addEventListener("click", () => {
      if (mode === "schedule") {
        const expr = cronSelect.value === "__custom__"
          ? cronInput.value.trim()
          : cronSelect.value;
        if (!expr || expr.split(/\s+/).length < 5) {
          alert(t("analysis.invalidCron"));
          return;
        }
        cron = expr;
      }
      // Remove the dialog immediately so it never sits over Progress.
      const choice: AnalysisRunChoice = {
        mode,
        debounceMs,
        cron,
        runImmediately: mode === "now" ? true : runImmediately,
      };
      close(choice);
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });
    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => startBtn.focus());
  });
}
