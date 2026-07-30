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

export const CRON_PRESETS: { label: string; value: string }[] = [
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at 9:00", value: "0 9 * * *" },
  { label: "Weekdays at 9:00", value: "0 9 * * 1-5" },
];

export function showAnalysisDialog(
  ruleCount: number,
  defaults?: Partial<AnalysisRunChoice>,
): Promise<AnalysisRunChoice | null> {
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
    title.textContent = "Run Analysis";

    const subtitle = document.createElement("p");
    subtitle.className = "modal-subtitle";
    subtitle.textContent = `${ruleCount} rule(s) selected. Choose how this analysis should run.`;

    const body = document.createElement("div");
    body.className = "modal-body run-mode-body";

    let mode: AnalysisRunMode = defaults?.mode ?? "now";
    let debounceMs = defaults?.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
    let cron = defaults?.cron ?? CRON_PRESETS[2]!.value;
    let runImmediately = defaults?.runImmediately ?? true;

    const modes: {
      id: AnalysisRunMode;
      title: string;
      desc: string;
    }[] = [
      {
        id: "now",
        title: "Run now",
        desc: "Start a single analysis immediately with the current rules and settings.",
      },
      {
        id: "watch",
        title: "On file changes",
        desc: "Watch the project folder and re-run after source files change.",
      },
      {
        id: "schedule",
        title: "On a schedule",
        desc: "Re-run on a cron schedule while DevTree stays open.",
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
      card.innerHTML = `
        <span class="run-mode-card-title">${item.title}</span>
        <span class="run-mode-card-desc">${item.desc}</span>
      `;
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
    debounceLabel.innerHTML = `<span>Debounce after changes</span>`;
    const debounceSelect = document.createElement("select");
    debounceSelect.className = "run-mode-select";
    for (const ms of [1000, 2000, 3000, 5000, 10000]) {
      const opt = document.createElement("option");
      opt.value = String(ms);
      opt.textContent = ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;
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
    cronLabel.innerHTML = `<span>Schedule</span>`;
    const cronSelect = document.createElement("select");
    cronSelect.className = "run-mode-select";
    for (const preset of CRON_PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset.value;
      opt.textContent = preset.label;
      if (preset.value === cron) opt.selected = true;
      cronSelect.appendChild(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = "__custom__";
    customOpt.textContent = "Custom cron…";
    cronSelect.appendChild(customOpt);

    const cronInput = document.createElement("input");
    cronInput.type = "text";
    cronInput.className = "run-mode-input";
    cronInput.placeholder = "min hour day month weekday";
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
    cronHint.textContent =
      "Cron uses local time (minute hour day-of-month month day-of-week).";
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
    immediateText.textContent = "Also run once now when enabling";
    immediateLabel.append(immediateInput, immediateText);
    sharedOptions.appendChild(immediateLabel);

    body.append(watchOptions, scheduleOptions, sharedOptions);
    syncOptionsVisibility();

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-ghost-modal";
    cancelBtn.textContent = "Cancel";

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "btn btn-primary";
    startBtn.textContent = "Start";

    actions.append(cancelBtn, startBtn);
    dialog.append(title, subtitle, body, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const close = (result: AnalysisRunChoice | null) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

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
          alert("Enter a valid 5-field cron expression.");
          return;
        }
        cron = expr;
      }
      close({
        mode,
        debounceMs,
        cron,
        runImmediately: mode === "now" ? true : runImmediately,
      });
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });
    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => startBtn.focus());
  });
}
