import { describe, expect, it } from "vitest";
import { renderModulesList } from "./modulesList";

describe("ui/modulesList", () => {
  it("exports renderModulesList", () => {
    expect(typeof renderModulesList).toBe("function");
  });
});
