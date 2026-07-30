import { describe, expect, it } from "vitest";
import { initResizers } from "./resizer";

describe("resizer", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => initResizers(document.createElement("div"), document.createElement("div"), document.createElement("div"), () => {})).not.toThrow();
    expect(container).toBeDefined();
  });
});
