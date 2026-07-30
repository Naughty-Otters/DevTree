import { describe, expect, it } from "vitest";
import { initResizers } from "./resizer";

describe("resizer", () => {
  it("creates or renders without throwing", () => {
    expect(() => initResizers()).not.toThrow();
  });
});
