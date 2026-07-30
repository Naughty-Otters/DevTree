import { describe, expect, it } from "vitest";
import { applyPanelSizes, readPanelSizes } from "./panels";

describe("state/panels", () => {
  it("round-trips panel sizes via CSS variables", () => {
    applyPanelSizes({ leftWidth: 280, rightWidth: 320, bottomHeight: 200, leftTreeHeight: 50 });
    const sizes = readPanelSizes();
    expect(sizes.leftWidth).toBe(280);
    expect(sizes.rightWidth).toBe(320);
  });
});
