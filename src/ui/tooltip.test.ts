import { describe, expect, it } from "vitest";
import { attachTooltip } from "./tooltip";

describe("tooltip", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => attachTooltip(document.createElement("button"), "hint")).not.toThrow();
    expect(container).toBeDefined();
  });
});
