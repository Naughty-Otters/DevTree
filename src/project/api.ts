import type {
  AnalysisResult,
  AnalysisRule,
  AnalysisProgress,
  RuleSettingsMap,
  RuleTaskProgress,
  ValidationItem,
} from "../analysis/types";
import type { DesignRule } from "../analysis/designRules";
import type {
  LlmProviderId,
  LlmProviderInfo,
} from "../agent/types";
import { isCliLlmProvider } from "../agent/types";
import { mockLlmProviders } from "../validation/llmCatalog";
import type { LspInstallResult, LspServerStatus, LspSettingsMap } from "../lsp/types";
import type {
  LanguageLinterGroup,
  LinterInstallResult,
  LinterSettingsMap,
} from "../linter/types";
import type { GitleaksInstallResult, GitleaksStatus } from "../gitleaks/types";
import type {
  TrufflehogInstallResult,
  TrufflehogStatus,
} from "../trufflehog/types";
import type {
  LlmConfiguration,
  AiValidationRuntimeSettings,
} from "../validation/aiValidation";
import {
  defaultAiValidationRuntimeSettings,
} from "../validation/aiValidation";
import {
  aiRuleLlmSettingDefs,
  architectureAssessmentSettingDefs,
  cleanCodePrincipleSettingDefs,
  codeReviewLensSettingDefs,
} from "../validation/aiValidation";
import type { ProjectScan, TreeEntry } from "./types";
import { mockHierarchyForFixture } from "../graph/hierarchy";
import { graphForNavigation, rootNavigation } from "../graph/navigation";
import type {
  AnalysisTriggerEvent,
  AnalysisTriggerStatus,
} from "../analysis/triggers";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openProjectDialog(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open Project",
  });
  if (selected === null || Array.isArray(selected)) return null;
  return selected;
}

export async function scanProject(path: string): Promise<ProjectScan> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ProjectScan>("scan_project_dir", { path });
  }
  return mockProjectScan(path);
}

/** Lazy-expand: immediate children of one folder under the project root. */
export async function listProjectChildren(
  path: string,
  relativePath: string,
): Promise<TreeEntry[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<TreeEntry[]>("list_project_children_cmd", {
      path,
      relativePath,
    });
  }
  return mockListProjectChildren(path, relativePath);
}

/** Hierarchy without symbols — for graph drill / DSM (not first paint). */
export async function loadAnalysisHierarchyLite(
  path: string,
): Promise<import("../analysis/types").HierarchyIndex> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("load_analysis_hierarchy_lite", { path });
  }
  return {
    files: [],
    packages: [],
    file_imports: {},
    package_edges: [],
    symbols: {},
    symbol_edges: [],
  };
}

/** Per-file quality metrics (lazy — module details / file ratings). */
export async function loadAnalysisQualityFiles(
  path: string,
): Promise<Record<string, import("../analysis/types").FileQualityMetrics>> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("load_analysis_quality_files", { path });
  }
  return {};
}

export async function getAnalysisRules(): Promise<AnalysisRule[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AnalysisRule[]>("get_analysis_rules");
  }
  return mockRules();
}

export async function listLspServers(): Promise<LspServerStatus[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LspServerStatus[]>("list_lsp_servers");
  }
  return mockLspServers();
}

export async function installLspServer(id: string): Promise<LspInstallResult> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LspInstallResult>("install_lsp_server", { id });
  }
  return {
    ok: false,
    message: "Language server install requires the DevTree desktop app.",
    server: mockLspServers().find((s) => s.id === id) ?? {
      id,
      language: id,
      label: id,
      status: "missing",
      installHint: "",
    },
  };
}

export async function getGitleaksStatus(): Promise<GitleaksStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitleaksStatus>("get_gitleaks_status");
  }
  return {
    status: "missing",
    installHint: "brew install gitleaks",
  };
}

export async function installGitleaks(): Promise<GitleaksInstallResult> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitleaksInstallResult>("install_gitleaks");
  }
  return {
    ok: false,
    message: "gitleaks install requires the DevTree desktop app.",
    status: {
      status: "missing",
      installHint: "brew install gitleaks",
    },
  };
}

export async function getTrufflehogStatus(): Promise<TrufflehogStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<TrufflehogStatus>("get_trufflehog_status");
  }
  return {
    status: "missing",
    installHint: "brew install trufflehog",
  };
}

export async function installTrufflehog(): Promise<TrufflehogInstallResult> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<TrufflehogInstallResult>("install_trufflehog");
  }
  return {
    ok: false,
    message: "trufflehog install requires the DevTree desktop app.",
    status: {
      status: "missing",
      installHint: "brew install trufflehog",
    },
  };
}

export async function listLanguageLinters(): Promise<LanguageLinterGroup[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LanguageLinterGroup[]>("list_language_linters");
  }
  return mockLanguageLinters();
}

export async function installLinter(
  languageId: string,
  linterId: string,
): Promise<LinterInstallResult> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LinterInstallResult>("install_linter", { languageId, linterId });
  }
  const group = mockLanguageLinters().find((g) => g.id === languageId);
  const linter = group?.linters.find((l) => l.id === linterId);
  return {
    ok: false,
    message: "Linter install requires the DevTree desktop app.",
    languageId,
    linter: linter ?? {
      id: linterId,
      label: linterId,
      status: "missing",
      installHint: "",
      isDefault: false,
    },
  };
}

export async function runAnalysis(
  path: string,
  rules: string[],
  analysisId: string,
  onProgress?: (progress: AnalysisProgress) => void,
  ruleSettings?: RuleSettingsMap,
  lspSettings?: LspSettingsMap,
  linterSettings?: LinterSettingsMap,
  llmConfigurations?: LlmConfiguration[],
  aiValidationRuntime?: AiValidationRuntimeSettings,
  designRules?: DesignRule[],
): Promise<AnalysisResult> {
  if (isTauri()) {
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<AnalysisProgress>();
    channel.onmessage = (progress) => {
      onProgress?.(progress);
    };
    return invoke<AnalysisResult>("run_project_analysis", {
      analysisId,
      path,
      rules,
      ruleSettings: ruleSettings ?? {},
      lspSettings: lspSettings ?? {},
      linterSettings: linterSettings ?? {},
      llmConfigurations: llmConfigurations ?? [],
      aiValidationRuntime: aiValidationRuntime ?? defaultAiValidationRuntimeSettings(),
      designRules: designRules ?? [],
      onProgress: channel,
    });
  }
  return mockAnalysis(path, rules, analysisId, onProgress, linterSettings, designRules);
}

export async function cancelAnalysis(analysisId: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("cancel_project_analysis", { analysisId });
  }
  return mockCancelAnalysis(analysisId);
}

export async function getAnalysisTriggers(): Promise<AnalysisTriggerStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AnalysisTriggerStatus>("get_analysis_triggers");
  }
  return {
    watchActive: false,
    watchDebounceMs: 0,
    scheduleActive: false,
  };
}

export async function startAnalysisWatch(
  path: string,
  debounceMs: number,
): Promise<AnalysisTriggerStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AnalysisTriggerStatus>("start_analysis_watch", {
      path,
      debounceMs,
    });
  }
  throw new Error("File-watch triggers require the DevTree desktop app.");
}

export async function stopAnalysisWatch(): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("stop_analysis_watch");
  }
  return false;
}

export async function startAnalysisSchedule(
  path: string,
  cron: string,
): Promise<AnalysisTriggerStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AnalysisTriggerStatus>("start_analysis_schedule", {
      path,
      cron,
    });
  }
  throw new Error("Scheduled triggers require the DevTree desktop app.");
}

export async function stopAnalysisSchedule(): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("stop_analysis_schedule");
  }
  return false;
}

export async function listenAnalysisTriggers(
  handler: (event: AnalysisTriggerEvent) => void,
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<AnalysisTriggerEvent>("analysis-trigger", (e) => {
    handler(e.payload);
  });
  return unlisten;
}

export async function getLlmProviders(): Promise<LlmProviderInfo[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LlmProviderInfo[]>("get_llm_providers");
  }
  return mockLlmProviders();
}

export async function listLlmModels(
  provider: LlmProviderId,
  apiKey: string,
): Promise<string[]> {
  if (isCliLlmProvider(provider)) {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string[]>("list_llm_models", { provider, apiKey: "" });
    }
    const defaults: Record<string, string> = {
      claude_code: "claude-code",
      codex: "codex",
      gemini_cli: "gemini",
    };
    return [defaults[provider] ?? provider];
  }
  if (!apiKey.trim()) {
    return [];
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string[]>("list_llm_models", { provider, apiKey });
  }
  return [];
}

export interface CliLlmBackendProbe {
  provider: LlmProviderId;
  binaryName: string;
  found: boolean;
  path?: string | null;
  hint: string;
}

export async function probeCliLlmBackend(
  provider: LlmProviderId,
): Promise<CliLlmBackendProbe> {
  if (!isCliLlmProvider(provider)) {
    throw new Error("Not a CLI LLM backend");
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<CliLlmBackendProbe>("probe_cli_llm_backend", { provider });
  }
  return {
    provider,
    binaryName: provider,
    found: false,
    path: null,
    hint: "CLI probe requires the desktop app",
  };
}

export interface GitFileChurn {
  path: string;
  linesAdded: number;
  linesDeleted: number;
  commits: number;
}

export interface GitChurnResult {
  available: boolean;
  days: number;
  files: GitFileChurn[];
  message?: string | null;
}

/** Git lines added/deleted/commits under a path for the last `days` (default 90). */
export async function gitCodeChurn(
  projectPath: string,
  path: string,
  days = 90,
): Promise<GitChurnResult> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitChurnResult>("git_code_churn", {
      projectPath,
      path,
      days,
    });
  }
  return {
    available: false,
    days,
    files: [],
    message: "Git churn requires the desktop app",
  };
}

export interface GitFileCcp {
  path: string;
  commits: number;
  correctiveCommits: number;
  ccp: number;
}

export interface GitCcpResult {
  available: boolean;
  days: number;
  projectCcp: number;
  files: GitFileCcp[];
  message?: string | null;
}

/** Corrective Commit Probability under a path for the last `days` (default 90). */
export async function gitCorrectiveCommitProbability(
  projectPath: string,
  path: string,
  days = 90,
): Promise<GitCcpResult> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitCcpResult>("git_corrective_commit_probability", {
      projectPath,
      path,
      days,
    });
  }
  return {
    available: false,
    days,
    projectCcp: 0,
    files: [],
    message: "Git CCP requires the desktop app",
  };
}

export async function readProjectFile(
  projectRoot: string,
  relativePath: string,
): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("read_project_file", {
      projectRoot,
      relativePath,
    });
  }
  return mockFileContent(relativePath);
}

export async function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_project_file", {
      projectRoot,
      relativePath,
      content,
    });
    return;
  }
  console.warn("writeProjectFile: browser mode — changes not persisted");
}

function mockLspServers(): LspServerStatus[] {
  const shared = [
    {
      key: "enabled",
      label: "Use during analysis",
      kind: "boolean" as const,
      default: true,
    },
    {
      key: "max_open_files",
      label: "Max files to open in the server",
      kind: "number" as const,
      default: 200,
      min: 10,
      max: 2000,
    },
    {
      key: "max_refs_per_symbol",
      label: "Max references per symbol",
      kind: "number" as const,
      default: 24,
      min: 1,
      max: 200,
    },
    {
      key: "diagnostic_wait_ms",
      label: "Wait for diagnostics (ms)",
      kind: "number" as const,
      default: 800,
      min: 0,
      max: 10000,
    },
    {
      key: "collect_symbols",
      label: "Collect document symbols",
      kind: "boolean" as const,
      default: true,
    },
    {
      key: "collect_references",
      label: "Collect symbol references",
      kind: "boolean" as const,
      default: false,
    },
    {
      key: "collect_diagnostics",
      label: "Collect diagnostics",
      kind: "boolean" as const,
      default: true,
    },
  ];

  return [
    {
      id: "typescript",
      language: "typescript",
      label: "TypeScript / JavaScript",
      status: "missing",
      installHint: "npm install -g typescript typescript-language-server",
      settings: [
        ...shared,
        {
          key: "include_javascript",
          label: "Include .js / .jsx files",
          kind: "boolean",
          default: true,
        },
      ],
    },
    {
      id: "rust",
      language: "rust",
      label: "Rust",
      status: "missing",
      installHint: "rustup component add rust-analyzer",
      settings: [
        ...shared,
        {
          key: "cargo_all_targets",
          label: "Analyze all Cargo targets",
          kind: "boolean",
          default: false,
        },
      ],
    },
    {
      id: "python",
      language: "python",
      label: "Python",
      status: "missing",
      installHint: "npm install -g basedpyright",
      settings: [
        ...shared,
        {
          key: "type_checking",
          label: "Enable type checking diagnostics",
          kind: "boolean",
          default: true,
        },
      ],
    },
    {
      id: "go",
      language: "go",
      label: "Go",
      status: "missing",
      installHint: "go install golang.org/x/tools/gopls@latest",
      settings: [
        ...shared,
        {
          key: "staticcheck",
          label: "Enable staticcheck diagnostics",
          kind: "boolean",
          default: true,
        },
      ],
    },
    {
      id: "java",
      language: "java",
      label: "Java",
      status: "missing",
      installHint: "brew install jdtls  (requires Java 17+)",
      settings: shared.map((s) =>
        s.key === "diagnostic_wait_ms" ? { ...s, default: 2500 } : s,
      ),
    },
  ];
}

function mockLanguageLinters(): LanguageLinterGroup[] {
  const levels = [
    { id: "error", label: "Errors only" },
    { id: "warning", label: "Warnings and errors" },
    { id: "info", label: "Info, warnings, and errors" },
  ];

  const linter = (
    id: string,
    label: string,
    installHint: string,
    isDefault: boolean,
  ) => ({
    id,
    label,
    status: "missing" as const,
    installHint,
    isDefault,
  });

  return [
    {
      id: "typescript",
      language: "typescript",
      label: "TypeScript / JavaScript",
      defaultLinterId: "eslint",
      defaultLevel: "warning",
      levels,
      linters: [
        linter("eslint", "ESLint", "npm install -g eslint", true),
        linter("biome", "Biome", "npm install -g @biomejs/biome", false),
        linter("oxlint", "Oxlint", "npm install -g oxlint", false),
      ],
    },
    {
      id: "rust",
      language: "rust",
      label: "Rust",
      defaultLinterId: "clippy",
      defaultLevel: "warning",
      levels,
      linters: [
        linter("clippy", "Clippy (cargo clippy)", "rustup component add clippy", true),
      ],
    },
    {
      id: "python",
      language: "python",
      label: "Python",
      defaultLinterId: "ruff",
      defaultLevel: "warning",
      levels,
      linters: [
        linter("ruff", "Ruff", "pip3 install ruff", true),
        linter("pylint", "Pylint", "pip3 install pylint", false),
        linter("flake8", "Flake8", "pip3 install flake8", false),
      ],
    },
    {
      id: "go",
      language: "go",
      label: "Go",
      defaultLinterId: "golangci-lint",
      defaultLevel: "warning",
      levels,
      linters: [
        linter(
          "golangci-lint",
          "golangci-lint",
          "go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest",
          true,
        ),
        linter(
          "staticcheck",
          "staticcheck",
          "go install honnef.co/go/tools/cmd/staticcheck@latest",
          false,
        ),
      ],
    },
  ];
}

function mockFileContent(path: string): string {
  return `// Browser mode — file preview unavailable for ${path}\n// Run with: npm run tauri dev\n`;
}

function mockRules(): AnalysisRule[] {
  const aiLlmSettings = aiRuleLlmSettingDefs();
  const aiArchitectureSettings = [
    ...aiLlmSettings,
    ...architectureAssessmentSettingDefs(),
  ];
  const aiCodeReviewSettings = [
    ...aiLlmSettings,
    ...codeReviewLensSettingDefs(),
  ];
  const aiCleanCodeSettings = [
    ...aiLlmSettings,
    ...cleanCodePrincipleSettingDefs(),
  ];
  return [
    {
      id: "modularity",
      name: "Modularity",
      description: "Detect tightly coupled modules and oversized files",
      category: "architecture",
      settings: [
        {
          key: "max_lines",
          label: "Warn when a module exceeds (lines)",
          kind: "number",
          default: 200,
          min: 50,
          max: 2000,
        },
      ],
    },
    {
      id: "dependency_depth",
      name: "Dependency Depth",
      description: "Flag modules with excessive import chains",
      category: "architecture",
      settings: [
        {
          key: "max_depth",
          label: "Warn when path depth exceeds",
          kind: "number",
          default: 4,
          min: 1,
          max: 20,
        },
      ],
    },
    {
      id: "circular_dependencies",
      name: "Circular Dependencies",
      description:
        "Detect import cycles between files and packages (resolved imports; optional LSP symbol reference cycles)",
      category: "architecture",
      settings: [
        {
          key: "check_file_imports",
          label: "Check file import cycles",
          kind: "boolean",
          default: true,
        },
        {
          key: "check_package_imports",
          label: "Check package import cycles",
          kind: "boolean",
          default: true,
        },
        {
          key: "check_symbol_references",
          label: "Check symbol reference cycles (requires LSP symbol references)",
          kind: "boolean",
          default: true,
        },
        {
          key: "sample_limit",
          label: "Max cycles to list",
          kind: "number",
          default: 10,
          min: 1,
          max: 50,
        },
      ],
    },
    {
      id: "type_coverage",
      name: "Type Coverage",
      description: "Check for untyped or loosely typed modules",
      category: "quality",
      settings: [
        {
          key: "flag_javascript",
          label: "Flag plain .js / .jsx files",
          kind: "boolean",
          default: true,
        },
      ],
    },
    {
      id: "test_coverage",
      name: "Test Coverage",
      description: "Identify modules lacking test files",
      category: "quality",
      settings: [
        {
          key: "warn_untested",
          label: "Warn when untested modules exceed",
          kind: "number",
          default: 3,
          min: 0,
          max: 100,
        },
        {
          key: "sample_limit",
          label: "Max affected files to list",
          kind: "number",
          default: 10,
          min: 1,
          max: 50,
        },
      ],
    },
    {
      id: "file_size",
      name: "File Size",
      description: "Warn about oversized source files",
      category: "maintainability",
      settings: [
        {
          key: "max_lines",
          label: "Fail when a file exceeds (lines)",
          kind: "number",
          default: 300,
          min: 50,
          max: 5000,
        },
      ],
    },
    {
      id: "naming",
      name: "Naming Conventions",
      description: "Check for inconsistent file and folder naming",
      category: "maintainability",
      settings: [
        {
          key: "flag_spaces",
          label: "Flag names containing spaces",
          kind: "boolean",
          default: true,
        },
        {
          key: "flag_mixed_case",
          label: "Flag mixed-case filenames with extensions",
          kind: "boolean",
          default: true,
        },
      ],
    },
    {
      id: "language_linters",
      name: "Language Linters",
      description:
        "Run configured linters (eslint, clippy, ruff, golangci-lint) and report issues in Validation.",
      category: "quality",
      settings: [
        {
          key: "enabled",
          label: "Run linters during validation",
          kind: "boolean",
          default: true,
        },
      ],
    },
    {
      id: "lsp_diagnostics",
      name: "Language Diagnostics",
      description:
        "Surface errors and warnings from language servers (rust-analyzer, tsserver, gopls, pyright, jdtls)",
      category: "quality",
      settings: [
        {
          key: "include_warnings",
          label: "Include warnings",
          kind: "boolean",
          default: true,
        },
        {
          key: "include_errors",
          label: "Include errors",
          kind: "boolean",
          default: true,
        },
        {
          key: "sample_limit",
          label: "Max diagnostics to list",
          kind: "number",
          default: 20,
          min: 1,
          max: 100,
        },
      ],
    },
    {
      id: "gitleaks",
      name: "Secret Scan (gitleaks)",
      description:
        "Scan the repository for hardcoded secrets and credentials using gitleaks",
      category: "security",
      settings: [
        {
          key: "enabled",
          label: "Run gitleaks during validation",
          kind: "boolean",
          default: true,
        },
        {
          key: "sample_limit",
          label: "Max findings to list",
          kind: "number",
          default: 20,
          min: 1,
          max: 100,
        },
      ],
    },
    {
      id: "trufflehog",
      name: "Secret Scan (TruffleHog)",
      description:
        "Scan the repository for secrets and credentials using TruffleHog",
      category: "security",
      settings: [
        {
          key: "enabled",
          label: "Run TruffleHog during validation",
          kind: "boolean",
          default: true,
        },
        {
          key: "verify",
          label: "Verify findings against live APIs (slower)",
          kind: "boolean",
          default: false,
        },
        {
          key: "only_verified",
          label: "Only report verified findings",
          kind: "boolean",
          default: false,
        },
        {
          key: "sample_limit",
          label: "Max findings to list",
          kind: "number",
          default: 20,
          min: 1,
          max: 100,
        },
      ],
    },
    {
      id: "ai_architecture",
      name: "AI Architecture Review",
      description:
        "Map project architecture from source, then evaluate selected assessment areas (patterns, design, security, debt, etc.).",
      category: "ai",
      settings: aiArchitectureSettings,
    },
    {
      id: "ai_code_review",
      name: "AI Code Reviewer",
      description:
        "Cross-cutting code review with selectable lenses (performance, security, quality, XSS, N+1, error handling, concurrency, logging, etc.).",
      category: "ai",
      settings: aiCodeReviewSettings,
    },
    {
      id: "ai_clean_code",
      name: "AI Clean Code Reviewer",
      description:
        "Review current workspace git changes against selectable Clean Code principles from the Softensity cheat sheet (general, design, naming, functions, SRP, DRY, structure, tests, smells, etc.).",
      category: "ai",
      settings: aiCleanCodeSettings,
    },
    {
      id: "ai_maintainability",
      name: "AI Maintainability Review",
      description: "LLM review of naming, duplication, and navigability issues.",
      category: "ai",
      settings: aiLlmSettings,
    },
    {
      id: "ai_test_gaps",
      name: "AI Test Gap Review",
      description: "LLM review of missing or weak test coverage in critical modules.",
      category: "ai",
      settings: aiLlmSettings,
    },
  ];
}

const mockTreeByPath: Record<string, TreeEntry[]> = {
  ".": [
    { name: "src", path: "src", kind: "directory", has_children: true },
    { name: "fixtures", path: "fixtures", kind: "directory", has_children: true },
  ],
  src: [
    { name: "canvas", path: "src/canvas", kind: "directory", has_children: true },
    { name: "main.ts", path: "src/main.ts", kind: "file" },
  ],
  "src/canvas": [
    { name: "renderer.ts", path: "src/canvas/renderer.ts", kind: "file" },
  ],
  fixtures: [
    { name: "sample-graph.json", path: "fixtures/sample-graph.json", kind: "file" },
  ],
};

function mockProjectScan(path: string): ProjectScan {
  const children = mockTreeByPath["."] ?? [];
  return {
    root: path,
    tree: {
      name: "DevTree",
      path: ".",
      kind: "directory",
      has_children: children.length > 0,
      children: children.map((c) => ({ ...c })),
    },
    modules: [],
  };
}

function mockListProjectChildren(
  _path: string,
  relativePath: string,
): TreeEntry[] {
  const key = relativePath === "" ? "." : relativePath;
  return (mockTreeByPath[key] ?? []).map((c) => ({ ...c }));
}

const mockCancelledAnalyses = new Set<string>();

function mockCancelAnalysis(analysisId: string): boolean {
  mockCancelledAnalyses.add(analysisId);
  return true;
}

async function mockAnalysis(
  path: string,
  rules: string[],
  analysisId: string,
  onProgress?: (progress: AnalysisProgress) => void,
  _linterSettings?: LinterSettingsMap,
  designRules?: DesignRule[],
): Promise<AnalysisResult> {
  const stages: AnalysisProgress[] = [
    { analysisId, stage: "scanning", message: "Starting breadth-first scan…", current: 0, total: 0, percent: 0 },
    { analysisId, stage: "scanning", message: "Found 12 source files", current: 12, total: 12, percent: 15 },
    { analysisId, stage: "reading", message: "Reading file contents (6/12)", current: 6, total: 12, percent: 28 },
    { analysisId, stage: "reading", message: "Reading file contents (12/12)", current: 12, total: 12, percent: 40 },
    { analysisId, stage: "analyzing", message: "Resolving imports & symbols (6/12)", current: 6, total: 12, percent: 62 },
    { analysisId, stage: "analyzing", message: "Resolving imports & symbols (12/12)", current: 12, total: 12, percent: 85 },
    { analysisId, stage: "validating", message: "Running validation rules…", current: rules.length, total: rules.length || 1, percent: 95 },
    { analysisId, stage: "done", message: "Analysis complete", current: 12, total: 12, percent: 100 },
  ];
  for (const stage of stages.slice(0, 5)) {
    if (mockCancelledAnalyses.has(analysisId)) {
      mockCancelledAnalyses.delete(analysisId);
      throw new Error("Analysis cancelled");
    }
    onProgress?.(stage);
    await new Promise((r) => setTimeout(r, 80));
  }

  const ruleNames: Record<string, string> = {
    modularity: "Modularity",
    dependency_depth: "Dependency Depth",
    circular_dependencies: "Circular Dependencies",
    type_coverage: "Type Coverage",
    test_coverage: "Test Coverage",
    file_size: "File Size",
    naming: "Naming Conventions",
    language_linters: "Language Linters",
    lsp_diagnostics: "Language Diagnostics",
    gitleaks: "Secret Scan (gitleaks)",
    trufflehog: "Secret Scan (TruffleHog)",
  };
  const ruleTasks: RuleTaskProgress[] = rules.map((id) => ({
    ruleId: id,
    ruleName: ruleNames[id] ?? id,
    status: "pending",
  }));

  onProgress?.({
    analysisId,
    stage: "validating",
    message: `Validating ${ruleTasks.length} rules in parallel…`,
    current: 0,
    total: ruleTasks.length,
    percent: 86,
    ruleTasks: ruleTasks.map((task) => ({ ...task, status: "running" as const })),
  });

  await Promise.all(
    ruleTasks.map(async (task, index) => {
      await new Promise((r) => setTimeout(r, 200 + index * 50));
      if (mockCancelledAnalyses.has(analysisId)) return;
      task.status = "done";
      const runningCount = ruleTasks.filter((t) => t.status === "running").length;
      onProgress?.({
        analysisId,
        stage: "validating",
        message: `${runningCount} running in parallel · ${ruleTasks.filter((t) => t.status === "done").length}/${ruleTasks.length} done`,
        current: ruleTasks.filter((t) => t.status === "done").length,
        total: ruleTasks.length,
        percent: 90,
        ruleTasks: [...ruleTasks],
      });
    }),
  );

  if (mockCancelledAnalyses.has(analysisId)) {
    mockCancelledAnalyses.delete(analysisId);
    throw new Error("Analysis cancelled");
  }

  onProgress?.(stages[stages.length - 1]!);
  await new Promise((r) => setTimeout(r, 80));
  mockCancelledAnalyses.delete(analysisId);

  const { loadFixtureGraph } = await import("../graph/loadFixture");
  const fixtureGraph = loadFixtureGraph();
  const hierarchy = mockHierarchyForFixture(fixtureGraph);
  const graph = graphForNavigation(hierarchy, rootNavigation());
  const { computeDsm } = await import("../analysis/dsm");
  const {
    checkDesignRules,
    designRulesValidationItem,
  } = await import("../analysis/designRules");
  const dsm = computeDsm(hierarchy);
  const violations = checkDesignRules(hierarchy, designRules ?? []);
  dsm.violations = violations;
  const validation: ValidationItem[] = rules.flatMap((id) => {
    if (id === "language_linters") {
      return [
        {
          rule_id: "linter:typescript",
          rule_name: "TypeScript / JavaScript (eslint)",
          status: "warn" as const,
          message:
            "Mock linter result (browser mode — run in Tauri for real eslint/clippy/ruff output)",
          affected: ["src/main.ts"],
        },
        {
          rule_id: "linter:rust",
          rule_name: "Rust (clippy)",
          status: "pass" as const,
          message: "No issues at warning level or above (mock)",
          affected: [],
        },
      ];
    }
    const names: Record<string, string> = {
      modularity: "Modularity",
      dependency_depth: "Dependency Depth",
      circular_dependencies: "Circular Dependencies",
      type_coverage: "Type Coverage",
      test_coverage: "Test Coverage",
      file_size: "File Size",
      naming: "Naming Conventions",
      lsp_diagnostics: "Language Diagnostics",
      gitleaks: "Secret Scan (gitleaks)",
      trufflehog: "Secret Scan (TruffleHog)",
    };
    return [
      {
        rule_id: id,
        rule_name: names[id] ?? id,
        status: "warn" as const,
        message: `Mock result for ${names[id] ?? id} (browser mode — run in Tauri for real analysis)`,
        affected: ["src/main.ts"],
      },
    ];
  });
  if ((designRules ?? []).length > 0) {
    validation.push(designRulesValidationItem(violations));
  }
  return {
    graph,
    hierarchy,
    validation,
    summary: `Mock analysis of ${path} with ${rules.length} rule(s) (browser mode)`,
    suggestions: [],
    dsm,
  };
}
