import { describe, expect, it } from "vitest";
import { mountToolbarIcons } from "./toolbar";

describe("ui/toolbar", () => {
  it("exports mountToolbarIcons", () => {
    expect(typeof mountToolbarIcons).toBe("function");
  });
});
