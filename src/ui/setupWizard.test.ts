import { describe, expect, it, vi } from "vitest";
import {
  buildSetupWizardSummary,
  canAdvanceFromProject,
  showSetupWizard,
  SETUP_WIZARD_STEPS,
  type SetupWizardDeps,
} from "./setupWizard";
import type { LspServerStatus } from "../lsp/types";
import type { LlmConfiguration } from "../validation/aiValidation";

describe("setupWizard helpers", () => {
  it("exposes five guided steps including secret scanners", () => {
    expect(SETUP_WIZARD_STEPS).toHaveLength(5);
    expect(SETUP_WIZARD_STEPS[0]?.title).toMatch(/project/i);
    expect(SETUP_WIZARD_STEPS[2]?.title).toMatch(/secret/i);
    expect(SETUP_WIZARD_STEPS[4]?.title).toMatch(/ready/i);
  });

  it("requires a project path before advancing from step 1", () => {
    expect(canAdvanceFromProject(null)).toBe(false);
    expect(canAdvanceFromProject("")).toBe(false);
    expect(canAdvanceFromProject("   ")).toBe(false);
    expect(canAdvanceFromProject("/Users/me/code/app")).toBe(true);
  });

  it("builds a readiness summary for project, LSP, secrets, and LLM", () => {
    const servers: LspServerStatus[] = [
      {
        id: "rust-analyzer",
        language: "rust",
        label: "rust-analyzer",
        status: "installed",
        installHint: "",
      },
      {
        id: "typescript-language-server",
        language: "typescript",
        label: "TypeScript",
        status: "missing",
        installHint: "npm i -g",
      },
    ];
    const configs: LlmConfiguration[] = [
      {
        id: "1",
        name: "Work",
        provider: "openai",
        apiKey: "sk-test",
        model: "gpt-4o",
        isGlobal: true,
      },
    ];

    const summary = buildSetupWizardSummary({
      projectPath: "/tmp/demo",
      servers,
      gitleaks: {
        status: "installed",
        command: "/opt/homebrew/bin/gitleaks",
        installHint: "brew install gitleaks",
      },
      trufflehog: {
        status: "missing",
        installHint: "brew install trufflehog",
      },
      configs,
    });

    expect(summary.projectPath).toBe("/tmp/demo");
    expect(summary.lspInstalled).toBe(1);
    expect(summary.lspTotal).toBe(2);
    expect(summary.secretScannersInstalled).toBe(1);
    expect(summary.secretScannersTotal).toBe(2);
    expect(summary.llmReady).toBe(true);
    expect(summary.llmLabel).toContain("Work");
    expect(summary.llmLabel).toContain("gpt-4o");
  });

  it("marks LLM as not ready when no API key is set", () => {
    const summary = buildSetupWizardSummary({
      projectPath: null,
      servers: [],
      configs: [
        {
          id: "1",
          name: "",
          provider: "openai",
          apiKey: "",
          model: "",
          isGlobal: true,
        },
      ],
    });
    expect(summary.llmReady).toBe(false);
    expect(summary.llmLabel).toBeNull();
  });
});

describe("showSetupWizard", () => {
  function mockDeps(overrides: Partial<SetupWizardDeps> = {}): SetupWizardDeps {
    return {
      openProject: vi.fn(async () => "/tmp/demo"),
      getProjectPath: vi.fn(() => null),
      listLspServers: vi.fn(async () => []),
      installLspServer: vi.fn(async (id) => ({
        ok: true,
        message: "ok",
        server: {
          id,
          language: "rust",
          label: id,
          status: "installed" as const,
          installHint: "",
        },
      })),
      getLspSettings: vi.fn(() => ({})),
      setLspSettings: vi.fn(),
      getGitleaksStatus: vi.fn(async () => ({
        status: "missing" as const,
        installHint: "brew install gitleaks",
      })),
      installGitleaks: vi.fn(async () => ({
        ok: true,
        message: "Installed",
        status: {
          status: "installed" as const,
          command: "gitleaks",
          installHint: "brew install gitleaks",
        },
      })),
      getTrufflehogStatus: vi.fn(async () => ({
        status: "missing" as const,
        installHint: "brew install trufflehog",
      })),
      installTrufflehog: vi.fn(async () => ({
        ok: true,
        message: "Installed",
        status: {
          status: "installed" as const,
          command: "trufflehog",
          installHint: "brew install trufflehog",
        },
      })),
      getLlmProviders: vi.fn(() => [{ id: "openai" as const, label: "OpenAI" }]),
      listLlmModels: vi.fn(async () => ["gpt-4o"]),
      getLlmConfigurations: vi.fn(() => []),
      setLlmConfigurations: vi.fn(),
      ...overrides,
    };
  }

  it("renders the modal without throwing and closes on Escape as dismissed", async () => {
    const deps = mockDeps();
    const promise = showSetupWizard(deps);
    expect(document.querySelector(".setup-wizard")).not.toBeNull();
    expect(document.querySelector("#setup-wizard-title")?.textContent).toMatch(
      /project/i,
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(promise).resolves.toEqual({ action: "dismissed" });
    expect(document.querySelector(".setup-wizard")).toBeNull();
  });

  it("keeps Next disabled until a project is selected", async () => {
    const deps = mockDeps({
      getProjectPath: vi.fn(() => null),
    });
    const promise = showSetupWizard(deps);
    const next = document.querySelector<HTMLButtonElement>(
      ".setup-wizard-actions .btn-primary",
    );
    expect(next?.disabled).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await promise;
  });

  it("enables Next after openProject sets a path", async () => {
    let path: string | null = null;
    const deps = mockDeps({
      getProjectPath: () => path,
      openProject: vi.fn(async () => {
        path = "/Users/me/code/DevTree";
        return path;
      }),
    });
    const promise = showSetupWizard(deps);
    const choose = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".setup-wizard-body .btn"),
    ).find((b) => /choose folder/i.test(b.textContent ?? ""));
    expect(choose).toBeTruthy();
    choose!.click();
    await vi.waitFor(() => {
      const next = document.querySelector<HTMLButtonElement>(
        ".setup-wizard-actions .btn-primary",
      );
      expect(next?.disabled).toBe(false);
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await promise;
  });

  it("loads and can install secret scanners on that wizard step", async () => {
    const installGitleaks = vi.fn(async () => ({
      ok: true,
      message: "Installed with Homebrew.",
      status: {
        status: "installed" as const,
        command: "gitleaks",
        installHint: "brew install gitleaks",
      },
    }));
    const onSecretScannerInstalled = vi.fn();
    const deps = mockDeps({
      getProjectPath: vi.fn(() => "/tmp/demo"),
      installGitleaks,
      onSecretScannerInstalled,
    });
    const promise = showSetupWizard(deps);

    // Project → LSP → Secret scanners
    document.querySelector<HTMLButtonElement>(".setup-wizard-actions .btn-primary")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#setup-wizard-title")?.textContent).toMatch(
        /language servers/i,
      );
    });
    document.querySelector<HTMLButtonElement>(".setup-wizard-actions .btn-primary")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#setup-wizard-title")?.textContent).toMatch(
        /secret scanners/i,
      );
      expect(deps.getGitleaksStatus).toHaveBeenCalled();
      expect(deps.getTrufflehogStatus).toHaveBeenCalled();
      const installBtn = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".setup-wizard-body .btn"),
      ).find((b) => b.textContent === "Install");
      expect(installBtn).toBeTruthy();
    });

    const installBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".setup-wizard-body .btn"),
    ).find((b) => b.textContent === "Install");
    installBtn!.click();
    await vi.waitFor(() => {
      expect(installGitleaks).toHaveBeenCalled();
      expect(onSecretScannerInstalled).toHaveBeenCalledWith("gitleaks");
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await promise;
  });
});
