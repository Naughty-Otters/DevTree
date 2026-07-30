import { describe, expect, it } from "vitest";
import {
  cycleGroupsFromValidation,
  cycleHighlightFromPlan,
  cycleKindLabel,
  planCycleGraphView,
} from "./cycles";
import { minimalHierarchy } from "../test/fixtures/hierarchy";

describe("validation/cycles", () => {
  it("labels cycle kinds", () => {
    expect(cycleKindLabel("file_imports")).toBe("File imports");
    expect(cycleKindLabel("package_imports")).toBe("Package imports");
    expect(cycleKindLabel("symbol_references")).toBe("Symbol references");
  });

  it("parses cycle groups from validation affected strings", () => {
    const groups = cycleGroupsFromValidation({
      rule_id: "circular_dependencies",
      affected: ["[cycle] src/a.ts → src/b.ts → src/a.ts"],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].path).toEqual(["src/a.ts", "src/b.ts", "src/a.ts"]);
  });

  it("uses structured cycle_groups when provided", () => {
    const structured = [
      { kind: "file_imports" as const, nodes: ["a"], path: ["a", "b"], label: "x" },
    ];
    const groups = cycleGroupsFromValidation({
      rule_id: "circular_dependencies",
      cycle_groups: structured,
      affected: [],
    });
    expect(groups).toEqual(structured);
  });

  it("plans graph view and highlight sets for file import cycles", () => {
    const hierarchy = minimalHierarchy();
    const cycle = {
      kind: "file_imports" as const,
      nodes: ["src/a.ts", "src/b.ts"],
      path: ["src/a.ts", "src/b.ts", "src/a.ts"],
      label: "cycle",
    };
    const plan = planCycleGraphView(hierarchy, cycle);
    expect(plan.nodeIds.length).toBeGreaterThan(0);
    const highlight = cycleHighlightFromPlan(plan);
    expect(highlight.nodeIds.size).toBeGreaterThan(0);
  });

  it("plans package and symbol reference cycles", () => {
    const hierarchy = minimalHierarchy();
    const packagePlan = planCycleGraphView(hierarchy, {
      kind: "package_imports",
      nodes: ["src", "lib"],
      path: ["src", "lib", "src"],
      label: "pkg cycle",
    });
    expect(packagePlan.navigation.crumbs.length).toBeGreaterThan(0);

    const symbolPlan = planCycleGraphView(hierarchy, {
      kind: "symbol_references",
      nodes: ["src/a.ts::main", "src/b.ts::main"],
      path: ["src/a.ts::main", "src/b.ts::main", "src/a.ts::main"],
      label: "sym cycle",
    });
    expect(symbolPlan.edgeKeys.length).toBeGreaterThanOrEqual(0);
  });

  it("parses package and symbol labels from affected strings", () => {
    const groups = cycleGroupsFromValidation({
      rule_id: "circular_dependencies",
      affected: [
        "[package cycle] pkg/a → pkg/b → pkg/a",
        "[symbol cycle] sym/a → sym/b → sym/a",
      ],
    });
    expect(groups[0].kind).toBe("package_imports");
    expect(groups[1].kind).toBe("symbol_references");
  });
});
