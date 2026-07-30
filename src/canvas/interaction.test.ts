import { describe, expect, it } from "vitest";
import { attachInteraction } from "./interaction";

describe("canvas/interaction", () => {
  it("exports attachInteraction", () => {
    expect(typeof attachInteraction).toBe("function");
  });
});
