import { describe, expect, it } from "vitest";

describe("boot", () => {
  it("exports startApp entrypoint", async () => {
    const mod = await import("./boot");
    expect(typeof mod.startApp).toBe("function");
  });
});
