import { describe, expect, it } from "vitest";
import { renderGraphNav } from "./graphNav";

describe("ui/graphNav", () => {
  it("exports renderGraphNav", () => {
    expect(typeof renderGraphNav).toBe("function");
  });
});
