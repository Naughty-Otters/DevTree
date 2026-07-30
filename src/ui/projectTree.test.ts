import { describe, expect, it } from "vitest";
import { renderProjectTree } from "./projectTree";

describe("ui/projectTree", () => {
  it("exports renderProjectTree", () => {
    expect(typeof renderProjectTree).toBe("function");
  });
});
