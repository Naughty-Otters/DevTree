import type {
  AnalysisResult,
  AnalysisRule,
  AnalysisProgress,
  RuleSettingsMap,
} from "../analysis/types";
import type { LspInstallResult, LspServerStatus, LspSettingsMap } from "../lsp/types";
import type { ProjectScan } from "./types";
import { mockHierarchyForFixture } from "../graph/hierarchy";

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

export async function runAnalysis(
  path: string,
  rules: string[],
  onProgress?: (progress: AnalysisProgress) => void,
  ruleSettings?: RuleSettingsMap,
  lspSettings?: LspSettingsMap,
): Promise<AnalysisResult> {
  if (isTauri()) {
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<AnalysisProgress>();
    channel.onmessage = (progress) => {
      onProgress?.(progress);
    };
    return invoke<AnalysisResult>("run_project_analysis", {
      path,
      rules,
      ruleSettings: ruleSettings ?? {},
      lspSettings: lspSettings ?? {},
      onProgress: channel,
    });
  }
  return mockAnalysis(path, rules, onProgress);
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
      default: true,
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
  ];
}

function mockFileContent(path: string): string {
  return `// Browser mode — file preview unavailable for ${path}\n// Run with: npm run tauri dev\n`;
}

function mockRules(): AnalysisRule[] {
  return [
    {
      id: "modularity",
      name: "Modularity",
      description: "Detect tightly coupled modules and circular dependencies",
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
      id: "lsp_diagnostics",
      name: "Language Diagnostics",
      description:
        "Surface errors and warnings from language servers (rust-analyzer, tsserver, gopls, pyright)",
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
  ];
}

function mockProjectScan(path: string): ProjectScan {
  return {
    root: path,
    tree: {
      name: "DevTree",
      path: ".",
      kind: "directory",
      children: [
        { name: "src", path: "src", kind: "directory", children: [
          { name: "main.ts", path: "src/main.ts", kind: "file" },
          { name: "canvas", path: "src/canvas", kind: "directory", children: [
            { name: "renderer.ts", path: "src/canvas/renderer.ts", kind: "file" },
          ]},
        ]},
        { name: "fixtures", path: "fixtures", kind: "directory", children: [
          { name: "sample-graph.json", path: "fixtures/sample-graph.json", kind: "file" },
        ]},
      ],
    },
    modules: [
      { name: "src", path: "src", kind: "folder", file_count: 8 },
      { name: "main.ts", path: "src/main.ts", kind: "file", file_count: 1 },
      { name: "renderer.ts", path: "src/canvas/renderer.ts", kind: "file", file_count: 1 },
    ],
  };
}

async function mockAnalysis(
  path: string,
  rules: string[],
  onProgress?: (progress: AnalysisProgress) => void,
): Promise<AnalysisResult> {
  const stages: AnalysisProgress[] = [
    { stage: "scanning", message: "Starting breadth-first scan…", current: 0, total: 0, percent: 0 },
    { stage: "scanning", message: "Found 12 source files", current: 12, total: 12, percent: 15 },
    { stage: "reading", message: "Reading file contents (6/12)", current: 6, total: 12, percent: 28 },
    { stage: "reading", message: "Reading file contents (12/12)", current: 12, total: 12, percent: 40 },
    { stage: "analyzing", message: "Resolving imports & symbols (6/12)", current: 6, total: 12, percent: 62 },
    { stage: "analyzing", message: "Resolving imports & symbols (12/12)", current: 12, total: 12, percent: 85 },
    { stage: "validating", message: "Running validation rules…", current: rules.length, total: rules.length || 1, percent: 95 },
    { stage: "done", message: "Analysis complete", current: 12, total: 12, percent: 100 },
  ];
  for (const stage of stages) {
    onProgress?.(stage);
    await new Promise((r) => setTimeout(r, 80));
  }

  const { loadFixtureGraph } = await import("../graph/loadFixture");
  const { graphForNavigation, rootNavigation } = await import("../graph/navigation");
  const fixtureGraph = loadFixtureGraph();
  const hierarchy = mockHierarchyForFixture(fixtureGraph);
  const graph = graphForNavigation(hierarchy, rootNavigation());
  const validation = rules.map((id) => {
    const names: Record<string, string> = {
      modularity: "Modularity",
      dependency_depth: "Dependency Depth",
      type_coverage: "Type Coverage",
      test_coverage: "Test Coverage",
      file_size: "File Size",
      naming: "Naming Conventions",
    };
    return {
      rule_id: id,
      rule_name: names[id] ?? id,
      status: "warn" as const,
      message: `Mock result for ${names[id] ?? id} (browser mode — run in Tauri for real analysis)`,
      affected: ["src/main.ts"],
    };
  });
  return {
    graph,
    hierarchy,
    validation,
    suggestions: [
      {
        priority: "medium" as const,
        title: "Run in Tauri for full analysis",
        description: `Browser mode uses fixture data. Open a real project with 'npm run tauri dev' for filesystem analysis of ${path}.`,
        targets: [],
      },
    ],
    summary: `Mock analysis of ${path} with ${rules.length} rule(s) (browser mode)`,
  };
}
