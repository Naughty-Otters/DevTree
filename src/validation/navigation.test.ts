import { describe, expect, it } from "vitest";
import {
  findSymbolAtLine,
  navigationToFile,
  navigationToPackageFile,
  resolveValidationTarget,
} from "./navigation";
import { minimalHierarchy } from "../test/fixtures/hierarchy";

describe("validation/navigation", () => {
  const hierarchy = minimalHierarchy();

  it("finds symbols at or before a line", () => {
    expect(findSymbolAtLine(hierarchy, "src/a.ts", 1)?.label).toBe("main");
    expect(findSymbolAtLine(hierarchy, "src/b.ts", 5)?.label).toBe("main");
  });

  it("resolves validation targets with symbol ids", () => {
    const target = resolveValidationTarget(hierarchy, "src/a.ts", 1);
    expect(target.symbolId).toBe("src/a.ts::main");
  });

  it("builds package and file navigation crumbs", () => {
    const pkgNav = navigationToPackageFile(hierarchy, "src/a.ts");
    expect(pkgNav.crumbs.some((c) => c.level === "package")).toBe(true);

    const fileNav = navigationToFile(hierarchy, "src/a.ts");
    expect(fileNav.crumbs.some((c) => c.level === "symbols")).toBe(true);
  });
});
