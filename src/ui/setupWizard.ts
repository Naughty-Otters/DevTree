import type { LlmProviderId, LlmProviderInfo } from "../agent/types";
import type { LspInstallResult, LspServerStatus, LspSettingsMap } from "../lsp/types";
import type { GitleaksInstallResult, GitleaksStatus } from "../gitleaks/types";
import type {
  TrufflehogInstallResult,
  TrufflehogStatus,
} from "../trufflehog/types";
import type { LlmConfiguration } from "../validation/aiValidation";
import {
  configuredLlmConfigurations,
  createLlmConfiguration,
  ensureSingleGlobal,
  isLlmConfigurationReady,
} from "../validation/aiValidation";
import { createLlmConfigFields } from "./llmConfigFields";
import { createLoadingPlaceholder } from "./loadingPlaceholder";

export type SetupWizardStep = 0 | 1 | 2 | 3 | 4;

export type SetupWizardResult =
  | { action: "done" }
  | { action: "runAnalysis" }
  | { action: "dismissed" };

export interface SetupWizardSummary {
  projectPath: string | null;
  lspInstalled: number;
  lspTotal: number;
  secretScannersInstalled: number;
  secretScannersTotal: number;
  llmReady: boolean;
  llmLabel: string | null;
}

export interface SetupWizardDeps {
  openProject: () => Promise<string | null>;
  getProjectPath: () => string | null;
  listLspServers: () => Promise<LspServerStatus[]>;
  installLspServer: (id: string) => Promise<LspInstallResult>;
  getLspSettings: () => LspSettingsMap;
  setLspSettings: (settings: LspSettingsMap) => void;
  getGitleaksStatus: () => Promise<GitleaksStatus>;
  installGitleaks: () => Promise<GitleaksInstallResult>;
  getTrufflehogStatus: () => Promise<TrufflehogStatus>;
  installTrufflehog: () => Promise<TrufflehogInstallResult>;
  /** Called after a secret scanner installs successfully (enable rules, refresh UI). */
  onSecretScannerInstalled?: (id: "gitleaks" | "trufflehog") => void;
  getLlmProviders: () => LlmProviderInfo[];
  listLlmModels: (provider: LlmProviderId, apiKey: string) => Promise<string[]>;
  getLlmConfigurations: () => LlmConfiguration[];
  setLlmConfigurations: (configs: LlmConfiguration[]) => void;
}

export const SETUP_WIZARD_STEPS = [
  { id: 0 as const, title: "Open a project", subtitle: "Choose the folder DevTree should analyze." },
  { id: 1 as const, title: "Language servers", subtitle: "Optional — analysis falls back to heuristics if missing." },
  {
    id: 2 as const,
    title: "Secret scanners",
    subtitle: "Optional — install gitleaks and TruffleHog for secret scanning rules.",
  },
  { id: 3 as const, title: "LLM configuration", subtitle: "Optional — needed only for AI validation rules." },
  { id: 4 as const, title: "You're ready", subtitle: "Review setup, then run analysis or finish." },
] as const;

type SecretScannerId = "gitleaks" | "trufflehog";

interface SecretScannerRow {
  id: SecretScannerId;
  label: string;
  description: string;
  status: "installed" | "missing" | "unknown";
  detail: string;
  error?: string;
}

export function canAdvanceFromProject(projectPath: string | null): boolean {
  return Boolean(projectPath && projectPath.trim());
}

export function buildSetupWizardSummary(input: {
  projectPath: string | null;
  servers: LspServerStatus[];
  gitleaks?: GitleaksStatus | null;
  trufflehog?: TrufflehogStatus | null;
  configs: LlmConfiguration[];
}): SetupWizardSummary {
  const installed = input.servers.filter((s) => s.status === "installed").length;
  const secrets: Array<GitleaksStatus | TrufflehogStatus | null | undefined> = [
    input.gitleaks,
    input.trufflehog,
  ];
  const secretTotal = 2;
  const secretInstalled = secrets.filter((s) => s?.status === "installed").length;
  const ready = configuredLlmConfigurations(input.configs);
  const global = ready.find((c) => c.isGlobal) ?? ready[0];
  return {
    projectPath: input.projectPath,
    lspInstalled: installed,
    lspTotal: input.servers.length,
    secretScannersInstalled: secretInstalled,
    secretScannersTotal: secretTotal,
    llmReady: ready.length > 0,
    llmLabel: global
      ? `${global.name || global.provider}${global.model ? ` · ${global.model}` : ""}`
      : null,
  };
}

export function showSetupWizard(deps: SetupWizardDeps): Promise<SetupWizardResult> {
  return new Promise((resolve) => {
    let step: SetupWizardStep = 0;
    let servers: LspServerStatus[] = [];
    let lspLoading = false;
    let installingId: string | null = null;
    let lspErrors: Record<string, string> = {};
    let gitleaksStatus: GitleaksStatus | null = null;
    let trufflehogStatus: TrufflehogStatus | null = null;
    let secretsLoading = false;
    let secretsLoaded = false;
    let secretErrors: Partial<Record<SecretScannerId | "_", string>> = {};
    let models: string[] = [];
    let modelsLoading = false;
    let modelsError: string | null = null;
    let draftConfig: LlmConfiguration = ensureWizardConfig(deps.getLlmConfigurations());

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog modal-dialog-wide setup-wizard";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-labelledby", "setup-wizard-title");
    dialog.setAttribute("aria-modal", "true");

    const stepsEl = document.createElement("div");
    stepsEl.className = "setup-wizard-steps";
    stepsEl.setAttribute("aria-hidden", "true");

    const title = document.createElement("h2");
    title.id = "setup-wizard-title";
    title.className = "modal-title";

    const subtitle = document.createElement("p");
    subtitle.className = "modal-subtitle";

    const body = document.createElement("div");
    body.className = "modal-body setup-wizard-body";

    const actions = document.createElement("div");
    actions.className = "modal-actions setup-wizard-actions";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn btn-ghost";
    backBtn.textContent = "Back";

    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "btn btn-ghost";
    skipBtn.textContent = "Skip";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "btn btn-primary";
    nextBtn.textContent = "Next";

    actions.append(backBtn, skipBtn, nextBtn);
    dialog.append(stepsEl, title, subtitle, body, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const close = (result: SetupWizardResult) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close({ action: "dismissed" });
    };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close({ action: "dismissed" });
    });

    backBtn.addEventListener("click", () => {
      if (step === 0) return;
      step = (step - 1) as SetupWizardStep;
      void render();
    });

    skipBtn.addEventListener("click", () => {
      if (step === 0) {
        close({ action: "dismissed" });
        return;
      }
      if (step === 4) {
        close({ action: "done" });
        return;
      }
      step = (step + 1) as SetupWizardStep;
      void render();
    });

    nextBtn.addEventListener("click", () => {
      if (step === 0 && !canAdvanceFromProject(deps.getProjectPath())) return;
      if (step === 3) {
        persistDraftConfig();
      }
      if (step < 4) {
        step = (step + 1) as SetupWizardStep;
        void render();
        return;
      }
      if (nextBtn.dataset.action === "run") {
        close({ action: "runAnalysis" });
      } else {
        close({ action: "done" });
      }
    });

    function persistDraftConfig(): void {
      if (!draftConfig.provider) return;
      const others = deps
        .getLlmConfigurations()
        .filter((c) => c.id !== draftConfig.id);
      const next = ensureSingleGlobal([
        ...others,
        { ...draftConfig, isGlobal: true },
      ]);
      deps.setLlmConfigurations(next);
    }

    async function loadLsp(): Promise<void> {
      if (lspLoading) return;
      lspLoading = true;
      renderBody();
      try {
        servers = await deps.listLspServers();
        lspErrors = {};
      } catch (err) {
        lspErrors = {
          _: err instanceof Error ? err.message : String(err),
        };
      } finally {
        lspLoading = false;
        renderBody();
        updateChrome();
      }
    }

    async function installServer(id: string): Promise<void> {
      installingId = id;
      delete lspErrors[id];
      renderBody();
      try {
        const result = await deps.installLspServer(id);
        servers = servers.map((s) => (s.id === id ? result.server : s));
        if (!result.ok) {
          lspErrors[id] = result.message;
        } else {
          servers = await deps.listLspServers();
        }
      } catch (err) {
        lspErrors[id] = err instanceof Error ? err.message : String(err);
      } finally {
        installingId = null;
        renderBody();
        updateChrome();
      }
    }

    async function loadSecretScanners(): Promise<void> {
      if (secretsLoading) return;
      secretsLoading = true;
      renderBody();
      try {
        const [gitleaks, trufflehog] = await Promise.all([
          deps.getGitleaksStatus(),
          deps.getTrufflehogStatus(),
        ]);
        gitleaksStatus = gitleaks;
        trufflehogStatus = trufflehog;
        secretErrors = {};
        secretsLoaded = true;
      } catch (err) {
        secretErrors = {
          _: err instanceof Error ? err.message : String(err),
        };
      } finally {
        secretsLoading = false;
        renderBody();
        updateChrome();
      }
    }

    async function installSecretScanner(id: SecretScannerId): Promise<void> {
      installingId = id;
      delete secretErrors[id];
      renderBody();
      try {
        const result =
          id === "gitleaks"
            ? await deps.installGitleaks()
            : await deps.installTrufflehog();
        if (id === "gitleaks") {
          gitleaksStatus = result.status;
        } else {
          trufflehogStatus = result.status;
        }
        if (!result.ok) {
          secretErrors[id] = result.message;
        } else {
          deps.onSecretScannerInstalled?.(id);
        }
      } catch (err) {
        secretErrors[id] = err instanceof Error ? err.message : String(err);
      } finally {
        installingId = null;
        renderBody();
        updateChrome();
      }
    }

    async function installMissingSecretScanners(): Promise<void> {
      const missing = secretScannerRows()
        .filter((row) => row.status !== "installed")
        .map((row) => row.id);
      for (const id of missing) {
        await installSecretScanner(id);
      }
    }

    function secretScannerRows(): SecretScannerRow[] {
      return [
        {
          id: "gitleaks",
          label: "gitleaks",
          description: "Fast local secret scan (Secret Scan · gitleaks)",
          status: gitleaksStatus?.status ?? "unknown",
          detail:
            gitleaksStatus?.status === "installed"
              ? gitleaksStatus.command || "Installed"
              : gitleaksStatus?.installHint || "Not checked yet",
          error: secretErrors.gitleaks,
        },
        {
          id: "trufflehog",
          label: "TruffleHog",
          description: "Deep secret detection (Secret Scan · TruffleHog)",
          status: trufflehogStatus?.status ?? "unknown",
          detail:
            trufflehogStatus?.status === "installed"
              ? trufflehogStatus.command || "Installed"
              : trufflehogStatus?.installHint || "Not checked yet",
          error: secretErrors.trufflehog,
        },
      ];
    }

    async function refreshModels(): Promise<void> {
      if (!draftConfig.provider || !draftConfig.apiKey.trim()) {
        models = [];
        modelsError = null;
        modelsLoading = false;
        return;
      }
      modelsLoading = true;
      modelsError = null;
      renderBody();
      try {
        models = await deps.listLlmModels(draftConfig.provider, draftConfig.apiKey);
      } catch (err) {
        models = [];
        modelsError = err instanceof Error ? err.message : String(err);
      } finally {
        modelsLoading = false;
        renderBody();
      }
    }

    function renderSteps(): void {
      stepsEl.replaceChildren();
      for (const s of SETUP_WIZARD_STEPS) {
        const dot = document.createElement("div");
        dot.className = "setup-wizard-step";
        if (s.id === step) dot.classList.add("is-current");
        if (s.id < step) dot.classList.add("is-done");
        const num = document.createElement("span");
        num.className = "setup-wizard-step-num";
        num.textContent = String(s.id + 1);
        const label = document.createElement("span");
        label.className = "setup-wizard-step-label";
        label.textContent = s.title;
        dot.append(num, label);
        stepsEl.appendChild(dot);
      }
    }

    function updateChrome(): void {
      const meta = SETUP_WIZARD_STEPS[step]!;
      title.textContent = meta.title;
      subtitle.textContent = meta.subtitle;
      backBtn.disabled = step === 0;
      backBtn.classList.toggle("hidden", step === 0);

      if (step === 0) {
        skipBtn.textContent = "Skip setup";
        skipBtn.classList.remove("hidden");
        nextBtn.textContent = "Next";
        nextBtn.dataset.action = "next";
        nextBtn.disabled = !canAdvanceFromProject(deps.getProjectPath());
      } else if (step === 4) {
        const hasProject = canAdvanceFromProject(deps.getProjectPath());
        nextBtn.textContent = hasProject ? "Run analysis" : "Done";
        nextBtn.dataset.action = hasProject ? "run" : "done";
        nextBtn.disabled = false;
        if (hasProject) {
          skipBtn.textContent = "Done";
          skipBtn.classList.remove("hidden");
        } else {
          skipBtn.classList.add("hidden");
        }
      } else {
        skipBtn.textContent = "Skip";
        skipBtn.classList.remove("hidden");
        nextBtn.textContent = "Next";
        nextBtn.dataset.action = "next";
        nextBtn.disabled = false;
      }
      renderSteps();
    }

    function renderBody(): void {
      body.replaceChildren();
      if (step === 0) renderProjectStep();
      else if (step === 1) renderLspStep();
      else if (step === 2) renderSecretScannersStep();
      else if (step === 3) renderLlmStep();
      else renderSummaryStep();
    }

    function renderProjectStep(): void {
      const copy = document.createElement("p");
      copy.className = "setup-wizard-copy";
      copy.textContent =
        "DevTree builds a dependency graph and runs architecture checks on a local project folder.";

      const pathBox = document.createElement("div");
      pathBox.className = "setup-wizard-path";
      const path = deps.getProjectPath();
      pathBox.textContent = path ?? "No project selected";
      if (!path) pathBox.classList.add("is-empty");

      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "btn btn-primary";
      choose.textContent = path ? "Change folder…" : "Choose folder…";
      choose.addEventListener("click", () => {
        void (async () => {
          choose.disabled = true;
          try {
            await deps.openProject();
          } finally {
            choose.disabled = false;
            renderBody();
            updateChrome();
          }
        })();
      });

      body.append(copy, pathBox, choose);
    }

    function renderLspStep(): void {
      const header = document.createElement("div");
      header.className = "setup-wizard-lsp-header";

      const note = document.createElement("p");
      note.className = "setup-wizard-copy";
      note.textContent =
        "Install language servers for richer diagnostics. You can skip this and configure later in Settings.";

      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "btn-text";
      refresh.textContent = "Refresh";
      refresh.disabled = lspLoading || installingId != null;
      refresh.addEventListener("click", () => {
        void loadLsp();
      });

      header.append(note, refresh);
      body.appendChild(header);

      const list = document.createElement("div");
      list.className = "setup-wizard-lsp-list";

      if (lspErrors._) {
        const err = document.createElement("div");
        err.className = "setup-wizard-error";
        err.textContent = lspErrors._;
        list.appendChild(err);
      }

      if (lspLoading && servers.length === 0) {
        list.appendChild(
          createLoadingPlaceholder({
            title: "Checking language servers…",
            size: "panel",
          }),
        );
      } else if (servers.length === 0) {
        const empty = document.createElement("div");
        empty.className = "setup-wizard-empty";
        empty.textContent = "Click Refresh to check installed language servers.";
        list.appendChild(empty);
      } else {
        for (const server of servers) {
          list.appendChild(lspRow(server));
        }
      }
      body.appendChild(list);
    }

    function lspRow(server: LspServerStatus): HTMLElement {
      const row = document.createElement("div");
      row.className = "setup-wizard-lsp-row";

      const info = document.createElement("div");
      info.className = "setup-wizard-lsp-info";
      const name = document.createElement("div");
      name.className = "setup-wizard-lsp-name";
      name.textContent = server.label;
      const meta = document.createElement("div");
      meta.className = "setup-wizard-lsp-meta";
      meta.textContent =
        server.status === "installed"
          ? server.command || "Installed"
          : server.installHint || "Not installed";
      info.append(name, meta);

      if (lspErrors[server.id]) {
        const err = document.createElement("div");
        err.className = "setup-wizard-error";
        err.textContent = lspErrors[server.id]!;
        info.appendChild(err);
      }

      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn btn-ghost";
      if (server.status === "installed") {
        action.textContent = "Installed";
        action.disabled = true;
      } else {
        action.textContent = installingId === server.id ? "Installing…" : "Install";
        action.disabled = installingId != null || lspLoading;
        action.addEventListener("click", () => {
          void installServer(server.id);
        });
      }

      row.append(info, action);
      return row;
    }

    function renderSecretScannersStep(): void {
      const header = document.createElement("div");
      header.className = "setup-wizard-lsp-header";

      const note = document.createElement("p");
      note.className = "setup-wizard-copy";
      note.textContent =
        "Install secret scanners used by Security rules. DevTree will try Homebrew, go install, or another supported package manager.";

      const actionsRow = document.createElement("div");
      actionsRow.className = "setup-wizard-secret-actions";

      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "btn-text";
      refresh.textContent = "Refresh";
      refresh.disabled = secretsLoading || installingId != null;
      refresh.addEventListener("click", () => {
        void loadSecretScanners();
      });

      const installAll = document.createElement("button");
      installAll.type = "button";
      installAll.className = "btn btn-ghost";
      const missingCount = secretScannerRows().filter(
        (row) => row.status !== "installed",
      ).length;
      installAll.textContent =
        installingId != null ? "Installing…" : "Install missing";
      installAll.disabled =
        secretsLoading || installingId != null || missingCount === 0;
      installAll.addEventListener("click", () => {
        void installMissingSecretScanners();
      });

      actionsRow.append(refresh, installAll);
      header.append(note, actionsRow);
      body.appendChild(header);

      const list = document.createElement("div");
      list.className = "setup-wizard-lsp-list";

      if (secretErrors._) {
        const err = document.createElement("div");
        err.className = "setup-wizard-error";
        err.textContent = secretErrors._;
        list.appendChild(err);
      }

      if (secretsLoading && !secretsLoaded) {
        list.appendChild(
          createLoadingPlaceholder({
            title: "Checking secret scanners…",
            size: "panel",
          }),
        );
      } else {
        for (const row of secretScannerRows()) {
          list.appendChild(secretScannerRow(row));
        }
      }
      body.appendChild(list);
    }

    function secretScannerRow(scanner: SecretScannerRow): HTMLElement {
      const row = document.createElement("div");
      row.className = "setup-wizard-lsp-row";

      const info = document.createElement("div");
      info.className = "setup-wizard-lsp-info";
      const name = document.createElement("div");
      name.className = "setup-wizard-lsp-name";
      name.textContent = scanner.label;
      const meta = document.createElement("div");
      meta.className = "setup-wizard-lsp-meta";
      meta.textContent = `${scanner.description} · ${scanner.detail}`;
      info.append(name, meta);

      if (scanner.error) {
        const err = document.createElement("div");
        err.className = "setup-wizard-error";
        err.textContent = scanner.error;
        info.appendChild(err);
      }

      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn btn-ghost";
      if (scanner.status === "installed") {
        action.textContent = "Installed";
        action.disabled = true;
      } else {
        action.textContent =
          installingId === scanner.id ? "Installing…" : "Install";
        action.disabled = installingId != null || secretsLoading;
        action.addEventListener("click", () => {
          void installSecretScanner(scanner.id);
        });
      }

      row.append(info, action);
      return row;
    }

    function renderLlmStep(): void {
      const copy = document.createElement("p");
      copy.className = "setup-wizard-copy";
      copy.textContent =
        "Add one LLM configuration for AI rules (architecture, security, clean code). Skip if you only need graph and deterministic checks.";

      const fieldsRoot = document.createElement("div");
      fieldsRoot.className = "setup-wizard-llm-fields";

      const warn = document.createElement("p");
      warn.className = "setup-wizard-hint";
      if (!isLlmConfigurationReady(draftConfig)) {
        warn.textContent = "No API key yet — AI validation rules will stay unavailable until configured.";
      } else {
        warn.textContent = "This configuration will be saved as your global default.";
      }

      body.append(copy, fieldsRoot, warn);

      createLlmConfigFields(fieldsRoot, {
        providers: deps.getLlmProviders(),
        models,
        modelsLoading,
        modelsError,
        showApiKey: true,
        allowGlobal: false,
        classPrefix: "settings",
        value: {
          provider: draftConfig.provider,
          model: draftConfig.model,
          apiKey: draftConfig.apiKey,
        },
        onChange: (value) => {
          const providerChanged = value.provider !== draftConfig.provider;
          draftConfig = {
            ...draftConfig,
            provider: (value.provider || draftConfig.provider) as LlmConfiguration["provider"],
            model: value.model,
            apiKey: value.apiKey ?? draftConfig.apiKey,
            isGlobal: true,
            name: draftConfig.name || "Default",
          };
          if (providerChanged || value.apiKey !== undefined) {
            void refreshModels();
          }
          warn.textContent = isLlmConfigurationReady(draftConfig)
            ? "This configuration will be saved as your global default."
            : "No API key yet — AI validation rules will stay unavailable until configured.";
        },
        onProviderChange: () => {
          void refreshModels();
        },
      });
    }

    function renderSummaryStep(): void {
      persistDraftConfig();
      const summary = buildSetupWizardSummary({
        projectPath: deps.getProjectPath(),
        servers,
        gitleaks: gitleaksStatus,
        trufflehog: trufflehogStatus,
        configs: deps.getLlmConfigurations(),
      });

      const list = document.createElement("ul");
      list.className = "setup-wizard-checklist";

      list.appendChild(
        checklistItem(
          Boolean(summary.projectPath),
          "Project",
          summary.projectPath ?? "Not selected",
        ),
      );
      list.appendChild(
        checklistItem(
          summary.lspTotal === 0 || summary.lspInstalled > 0,
          "Language servers",
          summary.lspTotal === 0
            ? "Not checked yet (optional)"
            : `${summary.lspInstalled} of ${summary.lspTotal} installed`,
        ),
      );
      list.appendChild(
        checklistItem(
          summary.secretScannersInstalled > 0 || !secretsLoaded,
          "Secret scanners",
          !secretsLoaded
            ? "Not checked yet (optional)"
            : `${summary.secretScannersInstalled} of ${summary.secretScannersTotal} installed`,
        ),
      );
      list.appendChild(
        checklistItem(
          summary.llmReady,
          "LLM",
          summary.llmReady
            ? summary.llmLabel ?? "Configured"
            : "Not configured (AI rules skipped)",
        ),
      );

      const tip = document.createElement("p");
      tip.className = "setup-wizard-copy";
      tip.textContent = summary.projectPath
        ? "You can change LSP, secret scanners, and LLM settings anytime from the Settings panel."
        : "Open a project from the toolbar when you are ready to analyze code.";

      body.append(list, tip);
    }

    function checklistItem(
      ok: boolean,
      label: string,
      detail: string,
    ): HTMLLIElement {
      const li = document.createElement("li");
      li.className = `setup-wizard-check${ok ? " is-ok" : " is-warn"}`;
      const status = document.createElement("span");
      status.className = "setup-wizard-check-status";
      status.textContent = ok ? "OK" : "—";
      const text = document.createElement("div");
      const titleEl = document.createElement("div");
      titleEl.className = "setup-wizard-check-label";
      titleEl.textContent = label;
      const detailEl = document.createElement("div");
      detailEl.className = "setup-wizard-check-detail";
      detailEl.textContent = detail;
      text.append(titleEl, detailEl);
      li.append(status, text);
      return li;
    }

    async function render(): Promise<void> {
      updateChrome();
      renderBody();
      if (step === 1 && servers.length === 0 && !lspLoading) {
        await loadLsp();
      }
      if (step === 2 && !secretsLoaded && !secretsLoading) {
        await loadSecretScanners();
      }
      if (step === 3 && draftConfig.apiKey.trim() && models.length === 0 && !modelsLoading) {
        await refreshModels();
      }
      requestAnimationFrame(() => nextBtn.focus());
    }

    void render();
  });
}

function ensureWizardConfig(configs: LlmConfiguration[]): LlmConfiguration {
  const ready = configs.find(isLlmConfigurationReady);
  if (ready) return { ...ready, isGlobal: true };
  const global = configs.find((c) => c.isGlobal);
  if (global) return { ...global, isGlobal: true };
  if (configs[0]) return { ...configs[0], isGlobal: true };
  return createLlmConfiguration({ name: "Default", isGlobal: true });
}
