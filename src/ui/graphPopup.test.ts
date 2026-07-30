import { describe, expect, it } from "vitest";
import { showGraphPopup } from "./graphPopup";

describe("ui/graphPopup", () => {
  it("exports showGraphPopup", () => {
    expect(typeof showGraphPopup).toBe("function");
  });
});
