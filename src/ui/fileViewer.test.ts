import { describe, expect, it } from "vitest";
import { createFileViewer } from "./fileViewer";

describe("fileViewer", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createFileViewer(container, () => {})).not.toThrow();
    expect(container).toBeDefined();
  });
});
