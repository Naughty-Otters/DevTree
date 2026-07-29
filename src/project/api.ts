import type { AnalysisResult, AnalysisRule, AnalysisProgress } from "../analysis/types";
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

export async function runAnalysis(
  path: string,
  rules: string[],
  onProgress?: (progress: AnalysisProgress) => void,
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
    },
    {
      id: "dependency_depth",
      name: "Dependency Depth",
      description: "Flag modules with excessive import chains",
      category: "architecture",
    },
    {
      id: "type_coverage",
      name: "Type Coverage",
      description: "Check for untyped or loosely typed modules",
      category: "quality",
    },
    {
      id: "test_coverage",
      name: "Test Coverage",
      description: "Identify modules lacking test files",
      category: "quality",
    },
    {
      id: "file_size",
      name: "File Size",
      description: "Warn about oversized source files",
      category: "maintainability",
    },
    {
      id: "naming",
      name: "Naming Conventions",
      description: "Check for inconsistent file and folder naming",
      category: "maintainability",
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
