import { describe, expect, it } from "vitest";
import { clearHierarchyLoadCache } from "./hierarchy";

describe("lazy/hierarchy", () => {
  it("clears hierarchy load cache without error", () => {
    expect(() => clearHierarchyLoadCache()).not.toThrow();
  });
});
