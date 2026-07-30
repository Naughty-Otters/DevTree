import { describe, expect, it } from "vitest";

describe("lazy/rules", () => {
  it("exports lazy loader", async () => {
    const mod = await import("./rules");
    expect(mod).toBeDefined();
  });
});
