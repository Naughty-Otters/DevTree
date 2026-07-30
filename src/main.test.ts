import { describe, expect, it, vi } from "vitest";

describe("main", () => {
  it("schedules boot via runWhenIdle", async () => {
    vi.resetModules();
    const defer = await import("./lazy/defer");
    const spy = vi.spyOn(defer, "runWhenIdle").mockImplementation((task) => task());
    await import("./main");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
