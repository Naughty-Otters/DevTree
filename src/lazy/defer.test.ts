import { describe, expect, it, vi } from "vitest";
import { runWhenIdle, runWhenIdleAsync } from "./defer";

describe("lazy/defer", () => {
  it("runs deferred work via setTimeout fallback", async () => {
    vi.useFakeTimers();
    const task = vi.fn();
    runWhenIdle(task, 0);
    vi.runAllTimers();
    expect(task).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("runs async deferred work", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => undefined);
    runWhenIdleAsync(task, 0);
    vi.runAllTimers();
    await Promise.resolve();
    expect(task).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("uses requestIdleCallback when available", () => {
    const idle = vi.fn((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    });
    vi.stubGlobal("requestIdleCallback", idle);
    const task = vi.fn();
    runWhenIdle(task, 100);
    expect(idle).toHaveBeenCalled();
    expect(task).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
