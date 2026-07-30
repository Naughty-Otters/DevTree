import { describe, expect, it } from "vitest";

describe("lazy/fileViewer", () => {
  it("exports lazy loader", async () => {
    const mod = await import("./fileViewer");
    expect(mod).toBeDefined();
  });
});
