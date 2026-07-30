#!/usr/bin/env node
/**
 * Generates one Vitest file per TypeScript source module under src/.
 * Re-run after adding new modules; customize tests in the generated files.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP = new Set([
  "src/wasm/devtree_core.d.ts",
  "src/wasm/devtree_core_bg.wasm.d.ts",
]);

/** @type {Record<string, string>} */
const TESTS = {
  "src/agent/types.test.ts": `import { describe, expect, it } from "vitest";
import { DEFAULT_LLM_PROVIDER } from "./types";

describe("agent/types", () => {
  it("defines a default LLM provider", () => {
    expect(DEFAULT_LLM_PROVIDER).toBe("openai");
  });
});
`,
  "src/analysis/options.test.ts": `import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "./options";

describe("analysis/options", () => {
  it("defaults to file module granularity", () => {
    expect(DEFAULT_ANALYSIS_OPTIONS.moduleGranularity).toBe("file");
  });
});
`,
  "src/analysis/types.test.ts": `import { describe, expect, it } from "vitest";
import { defaultRuleSettings, HIERARCHY_VERSION, mergeRuleSettings, type AnalysisRule } from "./types";

const RULES: AnalysisRule[] = [
  { id: "r1", name: "Rule 1", description: "", category: "test", settings: [{ key: "n", label: "N", kind: "number", default: 1 }] },
];

describe("analysis/types", () => {
  it("builds default rule settings from rule defs", () => {
    expect(defaultRuleSettings(RULES).r1.n).toBe(1);
    expect(HIERARCHY_VERSION).toBeGreaterThan(0);
  });

  it("merges persisted settings over defaults", () => {
    const merged = mergeRuleSettings(RULES, { r1: { n: 5 } });
    expect(merged.r1.n).toBe(5);
  });
});
`,
  "src/canvas/camera.test.ts": `import { describe, expect, it } from "vitest";
import { fitCameraToContent } from "./camera";

describe("canvas/camera", () => {
  it("fits camera to node bounds", () => {
    const camera = fitCameraToContent(
      { x: 0, y: 0, zoom: 1 },
      { width: 800, height: 600 } as HTMLCanvasElement,
      [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 50 }],
    );
    expect(camera.zoom).toBeGreaterThan(0);
  });
});
`,
  "src/canvas/colors.test.ts": `import { describe, expect, it } from "vitest";
import { buildNodeColorMap, nodeColor } from "./colors";

describe("canvas/colors", () => {
  it("assigns stable palette colors", () => {
    expect(nodeColor("node-a")).toBe(nodeColor("node-a"));
    expect(buildNodeColorMap(["a", "b"]).size).toBe(2);
  });
});
`,
  "src/canvas/renderer.test.ts": `import { describe, expect, it } from "vitest";
import { createRenderState, screenToWorld, worldToScreen } from "./renderer";
import type { Graph } from "../graph/types";

const graph: Graph = {
  nodes: [{ id: "a", label: "A", path: "a.ts", loc: 1, kind: "file" }],
  edges: [],
};

describe("canvas/renderer", () => {
  it("converts between world and screen coordinates", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const state = createRenderState(graph, [], new Map());
    const screen = worldToScreen(state.camera, canvas, 10, 20);
    const world = screenToWorld(state.camera, canvas, screen.x, screen.y);
    expect(world.x).toBeCloseTo(10, 0);
    expect(world.y).toBeCloseTo(20, 0);
  });
});
`,
  "src/graph/hierarchy.test.ts": `import { describe, expect, it } from "vitest";
import { hierarchyFromGraph } from "./hierarchy";
import { loadFixtureGraph } from "./loadFixture";

describe("graph/hierarchy", () => {
  it("indexes packages from fixture graph", () => {
    const graph = loadFixtureGraph();
    const hierarchy = hierarchyFromGraph(graph);
    expect(hierarchy.files.length).toBeGreaterThan(0);
    expect(hierarchy.packages.length).toBeGreaterThan(0);
  });
});
`,
  "src/graph/loadFixture.test.ts": `import { describe, expect, it } from "vitest";
import { loadFixtureGraph } from "./loadFixture";

describe("graph/loadFixture", () => {
  it("loads a non-empty fixture graph", () => {
    const graph = loadFixtureGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
  });
});
`,
  "src/graph/navigation.test.ts": `import { describe, expect, it } from "vitest";
import { rootNavigation } from "./navigation";
import { loadFixtureGraph } from "./loadFixture";
import { hierarchyFromGraph } from "./hierarchy";

describe("graph/navigation", () => {
  it("starts at package root", () => {
    const hierarchy = hierarchyFromGraph(loadFixtureGraph());
    const nav = rootNavigation(hierarchy);
    expect(nav.level).toBe("packages");
    expect(nav.nodeIds.length).toBeGreaterThan(0);
  });
});
`,
  "src/graph/types.test.ts": `import { describe, expect, it } from "vitest";
import type { Graph } from "./types";

describe("graph/types", () => {
  it("accepts a minimal graph shape", () => {
    const graph: Graph = {
      nodes: [{ id: "n", label: "N", path: "n.ts", loc: 1, kind: "file" }],
      edges: [],
    };
    expect(graph.nodes[0].id).toBe("n");
  });
});
`,
  "src/lazy/defer.test.ts": `import { describe, expect, it, vi } from "vitest";
import { runWhenIdle } from "./defer";

describe("lazy/defer", () => {
  it("runs deferred work", async () => {
    vi.useFakeTimers();
    const task = vi.fn();
    runWhenIdle(task, 0);
    vi.runAllTimers();
    expect(task).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
`,
  "src/lazy/fileViewer.test.ts": `import { describe, expect, it } from "vitest";

describe("lazy/fileViewer", () => {
  it("exports lazy loader", async () => {
    const mod = await import("./fileViewer");
    expect(mod).toBeDefined();
  });
});
`,
  "src/lazy/hierarchy.test.ts": `import { describe, expect, it } from "vitest";
import { clearHierarchyLoadCache } from "./hierarchy";

describe("lazy/hierarchy", () => {
  it("clears hierarchy load cache without error", () => {
    expect(() => clearHierarchyLoadCache()).not.toThrow();
  });
});
`,
  "src/lazy/rules.test.ts": `import { describe, expect, it } from "vitest";

describe("lazy/rules", () => {
  it("exports lazy loader", async () => {
    const mod = await import("./rules");
    expect(mod).toBeDefined();
  });
});
`,
  "src/linter/types.test.ts": `import { describe, expect, it } from "vitest";
import { ensureLinterSettings } from "./types";

describe("linter/types", () => {
  it("ensures linter settings map exists", () => {
    const settings = ensureLinterSettings({});
    expect(settings).toBeDefined();
  });
});
`,
  "src/lsp/types.test.ts": `import { describe, expect, it } from "vitest";
import { mergeLspSettings } from "./types";

describe("lsp/types", () => {
  it("merges LSP settings over defaults", () => {
    const merged = mergeLspSettings({});
    expect(merged).toBeDefined();
  });
});
`,
  "src/main.test.ts": `import { describe, expect, it, vi } from "vitest";

describe("main", () => {
  it("schedules boot via runWhenIdle", async () => {
    vi.resetModules();
    const defer = await import("./lazy/defer");
    const spy = vi.spyOn(defer, "runWhenIdle").mockImplementation((task) => task());
    await import("./main");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
`,
  "src/project/types.test.ts": `import { describe, expect, it } from "vitest";
import type { ProjectScan } from "./types";

describe("project/types", () => {
  it("accepts a project scan shape", () => {
    const scan: ProjectScan = { root: "/tmp/proj", files: [] };
    expect(scan.root).toBe("/tmp/proj");
  });
});
`,
  "src/state/panels.test.ts": `import { describe, expect, it } from "vitest";
import { applyPanelSizes, readPanelSizes } from "./panels";

describe("state/panels", () => {
  it("round-trips panel sizes via CSS variables", () => {
    document.documentElement.style.setProperty("--panel-left-width", "240px");
    applyPanelSizes({ left: 280, right: 320 });
    const sizes = readPanelSizes();
    expect(sizes.left).toBe(280);
    expect(sizes.right).toBe(320);
  });
});
`,
  "src/state/types.test.ts": `import { describe, expect, it } from "vitest";
import { defaultPersistedState } from "./types";

describe("state/types", () => {
  it("provides default persisted state", () => {
    const state = defaultPersistedState();
    expect(state.ui).toBeDefined();
  });
});
`,
  "src/validation/fileIssues.test.ts": `import { describe, expect, it } from "vitest";
import { collectFileIssues } from "./fileIssues";
import type { AnalysisResult } from "../analysis/types";

describe("validation/fileIssues", () => {
  it("collects issues for a matching file path", () => {
    const result: AnalysisResult = {
      graph: { nodes: [], edges: [] },
      validation: [{
        rule_id: "lint",
        rule_name: "Lint",
        status: "fail",
        message: "issue",
        affected: ["src/a.ts:3 — [error] bad"],
      }],
      suggestions: [],
      summary: "",
    };
    const issues = collectFileIssues(result, "src/a.ts");
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
  });
});
`,
  "src/validation/llmCatalog.test.ts": `import { describe, expect, it } from "vitest";
import { effectiveLlmModel } from "./llmCatalog";

describe("validation/llmCatalog", () => {
  it("resolves effective model from provider config", () => {
    const model = effectiveLlmModel("openai", { model: "gpt-4o-mini" });
    expect(model).toBe("gpt-4o-mini");
  });
});
`,
  "src/validation/navigation.test.ts": `import { describe, expect, it } from "vitest";
import { navigationToFile } from "./navigation";

describe("validation/navigation", () => {
  it("builds file navigation target", () => {
    const target = navigationToFile("src/a.ts", 10);
    expect(target.file).toBe("src/a.ts");
    expect(target.line).toBe(10);
  });
});
`,
  "src/wasm-bridge.test.ts": `import { describe, expect, it } from "vitest";
import { computeLayout } from "./wasm-bridge";
import type { Graph } from "./graph/types";

describe("wasm-bridge", () => {
  it("computes layout positions from graph JSON", async () => {
    const graph: Graph = { nodes: [], edges: [] };
    const positions = await computeLayout(graph);
    expect(Array.isArray(positions)).toBe(true);
  });
});
`,
  "src/boot.test.ts": `import { describe, expect, it } from "vitest";

describe("boot", () => {
  it("exports startApp entrypoint", async () => {
    const mod = await import("./boot");
    expect(typeof mod.startApp).toBe("function");
  });
});
`,
  "src/ui/icons.test.ts": `import { describe, expect, it } from "vitest";
import { createChevron, createFileIcon } from "./icons";

describe("ui/icons", () => {
  it("creates lucide SVG icons", () => {
    expect(createChevron(true).tagName.toLowerCase()).toBe("svg");
    expect(createFileIcon("app.ts").tagName.toLowerCase()).toBe("svg");
  });
});
`,
};

function uiPanelTest(importPath, createFn, args) {
  return `import { describe, expect, it } from "vitest";
import { ${createFn} } from "${importPath}";

describe("${importPath.replace(/^\.\//, "")}", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => ${createFn}(${args})).not.toThrow();
    expect(container).toBeDefined();
  });
});
`;
}

const UI_PANELS = [
  ["src/ui/aiStreamPreview.test.ts", "./aiStreamPreview", "renderAiStreamPreview", `container, { text: "hello", active: true }`],
  ["src/ui/analysisDetailPopup.test.ts", "./analysisDetailPopup", "showAnalysisDetail", `container, { title: "t", body: "b" }, {}`],
  ["src/ui/analysisDialog.test.ts", "./analysisDialog", "showAnalysisDialog", `container, { title: "t", message: "m" }, () => {}`],
  ["src/ui/fileNav.test.ts", "./fileNav", "renderFileNav", `container, { path: "a.ts", onNavigate: () => {} }`],
  ["src/ui/fileViewer.test.ts", "./fileViewer", "createFileViewer", `container, { onOpenPath: () => {} }`],
  ["src/ui/graphNav.test.ts", "./graphNav", "renderGraphNav", `container, { options: { showPackages: true }, callbacks: { onDrill: () => {} } }`],
  ["src/ui/graphPopup.test.ts", "./graphPopup", "showGraphPopup", `container, { title: "t", graph: { nodes: [], edges: [] } }, () => {}`],
  ["src/ui/llmConfigFields.test.ts", "./llmConfigFields", "createLlmConfigFields", `container, { value: { provider: "openai", model: "gpt-4o-mini", apiKey: "" }, onChange: () => {} }`],
  ["src/ui/llmConfigurationPicker.test.ts", "./llmConfigurationPicker", "createLlmConfigurationPicker", `container, { configurations: [], selectedId: null, providers: [], onChange: () => {} }`],
  ["src/ui/llmProviderConfigsPanel.test.ts", "./llmProviderConfigsPanel", "createLlmProviderConfigsPanel", `container, { providers: [], configs: {}, onChange: () => {} }`],
  ["src/ui/llmRuntimeSettingsPanel.test.ts", "./llmRuntimeSettingsPanel", "createLlmRuntimeSettingsPanel", `container, { maxTurns: 128, agentMaxTurns: 64 }, { onChange: () => {} }`],
  ["src/ui/lspServersPanel.test.ts", "./lspServersPanel", "createLspServersPanel", `container, { servers: [], installing: new Set(), onInstall: async () => {} }`],
  ["src/ui/lintersPanel.test.ts", "./lintersPanel", "createLintersPanel", `container, { linters: [], installing: new Set(), onInstall: async () => {} }`],
  ["src/ui/modulesList.test.ts", "./modulesList", "renderModulesList", `container, { packages: [], selected: null, onSelect: () => {} }`],
  ["src/ui/projectTree.test.ts", "./projectTree", "renderProjectTree", `container, [], { onSelect: () => {} }`],
  ["src/ui/resizer.test.ts", "./resizer", "initResizers", `document.createElement("div"), document.createElement("div"), document.createElement("div"), () => {}`],
  ["src/ui/resultsPanel.test.ts", "./resultsPanel", "createResultsPanel", `container, { validation: [], suggestions: [], summary: "" }, {}`],
  ["src/ui/rulesPanel.test.ts", "./rulesPanel", "createRulesPanel", `container, { rules: [], selected: new Set(), settings: {}, expandedRuleId: null, loading: true }, () => {}`],
  ["src/ui/settingsPanel.test.ts", "./settingsPanel", "createSettingsPanel", `container, { onClose: () => {} }`],
  ["src/ui/toolbar.test.ts", "./toolbar", "renderToolbar", `container, { projectName: "demo", onOpenProject: () => {} }`],
  ["src/ui/tooltip.test.ts", "./tooltip", "attachTooltip", `document.createElement("button"), "hint"`],
  ["src/ui/validationDetailPopup.test.ts", "./validationDetailPopup", "showValidationDetail", `container, { ruleName: "r", status: "fail", message: "m", affected: [] }, {}`],
];

for (const [file, importPath, fn, args] of UI_PANELS) {
  TESTS[file] = uiPanelTest(importPath, fn, args);
}

// Remaining modules with dynamic import smoke tests
const SMOKE = [
  "src/analysis/manager.ts",
  "src/canvas/highlights.ts",
  "src/canvas/interaction.ts",
  "src/canvas/nodeIcons.ts",
  "src/project/api.ts",
  "src/state/store.ts",
  "src/validation/cycles.ts",
];

for (const src of SMOKE) {
  const testFile = src.replace(/\.ts$/, ".test.ts");
  if (TESTS[testFile]) continue;
  const rel = "./" + src.split("/").slice(1).join("/").replace(/\.ts$/, "");
  const label = src.startsWith("src/") ? src.slice(4) : src;
  TESTS[testFile] = `import { describe, expect, it } from "vitest";

describe("${label}", () => {
  it("module loads", async () => {
    const mod = await import("${rel}");
    expect(mod).toBeDefined();
  });
});
`;
}

let created = 0;
let skipped = 0;

for (const [relPath, content] of Object.entries(TESTS)) {
  if (SKIP.has(relPath)) continue;
  const abs = join(root, relPath);
  if (existsSync(abs)) {
    skipped++;
    continue;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  created++;
}

console.log(`Generated ${created} test file(s), skipped ${skipped} existing.`);
