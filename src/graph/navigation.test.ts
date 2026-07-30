import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  drillIntoFile,
  drillIntoPackage,
  drillTargetForNode,
  goBack,
  goForward,
  graphForNavigation,
  hasStaleImportIndex,
  isDrillableNode,
  rootNavigation,
  serializeNavigation,
} from "./navigation";
import { minimalHierarchy } from "../test/fixtures/hierarchy";
import { HIERARCHY_VERSION } from "../analysis/types";

describe("graph/navigation", () => {
  const hierarchy = minimalHierarchy();

  it("starts at package root", () => {
    const nav = rootNavigation();
    expect(nav.crumbs[0]?.level).toBe("packages");
    expect(nav.historyIndex).toBe(0);
  });

  it("drills into packages and files with history", () => {
    let nav = drillIntoPackage(rootNavigation(), "src", "src");
    nav = drillIntoFile(nav, "src/a.ts", "a.ts");
    expect(nav.crumbs.at(-1)?.level).toBe("symbols");
    expect(canGoBack(nav)).toBe(true);
    const back = goBack(nav);
    expect(back.crumbs.at(-1)?.level).toBe("package");
    const forward = goForward(back);
    expect(forward.crumbs.at(-1)?.level).toBe("symbols");
    expect(canGoForward(back)).toBe(true);
  });

  it("builds graphs for navigation levels", () => {
    const packages = graphForNavigation(hierarchy, rootNavigation());
    expect(packages.nodes.length).toBeGreaterThan(0);

    const pkgNav = drillIntoPackage(rootNavigation(), "src", "src");
    const pkgGraph = graphForNavigation(hierarchy, pkgNav);
    expect(pkgGraph.nodes.length).toBeGreaterThan(0);
  });

  it("detects drillable nodes and stale indexes", () => {
    const pkgNode = { id: "src", label: "src", path: "src", loc: 1, kind: "package" };
    expect(isDrillableNode(pkgNode, rootNavigation())).toBe(true);
    expect(hasStaleImportIndex({ ...hierarchy, version: 1 })).toBe(true);
    expect(hasStaleImportIndex({ ...hierarchy, version: HIERARCHY_VERSION })).toBe(false);
  });

  it("serializes navigation state", () => {
    const nav = drillIntoPackage(rootNavigation(), "src", "src");
    const copy = serializeNavigation(nav);
    expect(copy).not.toBe(nav);
    expect(copy.crumbs).toEqual(nav.crumbs);
  });

  it("drills targets for package and file nodes", () => {
    const pkgTarget = drillTargetForNode(
      { id: "src", label: "src", path: "src", loc: 1, kind: "package" },
      rootNavigation(),
    );
    expect(pkgTarget?.crumbs.at(-1)?.level).toBe("package");

    const pkgNav = drillIntoPackage(rootNavigation(), "src", "src");
    const fileTarget = drillTargetForNode(
      { id: "src/a.ts", label: "a.ts", path: "src/a.ts", loc: 1, kind: "file" },
      pkgNav,
    );
    expect(fileTarget?.crumbs.at(-1)?.level).toBe("symbols");
  });
});
