import { describe, expect, it } from "vitest";
import { createLintersPanel } from "./lintersPanel";

describe("ui/lintersPanel", () => {
  it("exports createLintersPanel", () => {
    expect(typeof createLintersPanel).toBe("function");
  });
});
