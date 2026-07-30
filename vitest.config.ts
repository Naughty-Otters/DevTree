import path from "node:path";
import { defineConfig } from "vitest/config";

/** Source files included in the 80% coverage gate (pure logic; UI/integration excluded). */
const COVERAGE_INCLUDE = [
  "src/validation/**/*.ts",
  "src/graph/hierarchy.ts",
  "src/graph/loadFixture.ts",
  "src/graph/navigation.ts",
  "src/analysis/types.ts",
  "src/analysis/options.ts",
  "src/analysis/progressDisplay.ts",
  "src/state/types.ts",
  "src/state/panels.ts",
  "src/agent/types.ts",
  "src/canvas/colors.ts",
  "src/canvas/highlights.ts",
  "src/linter/types.ts",
  "src/lsp/types.ts",
  "src/wasm-bridge.ts",
  "src/lazy/defer.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "./wasm/devtree_core.js": path.resolve(
        __dirname,
        "src/test/mocks/devtree_core.ts",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: COVERAGE_INCLUDE,
      exclude: [
        "src/**/*.test.ts",
        "src/wasm/**",
        "src/test/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 65,
      },
    },
  },
});
