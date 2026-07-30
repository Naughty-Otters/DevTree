import { describe, expect, it } from "vitest";
import type { ProjectScan } from "./types";

describe("project/types", () => {
  it("accepts a project scan shape", () => {
    const scan: ProjectScan = { root: "/tmp/proj", files: [] };
    expect(scan.root).toBe("/tmp/proj");
  });
});
