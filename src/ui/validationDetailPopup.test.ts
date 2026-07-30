import { describe, expect, it } from "vitest";
import { showValidationDetail } from "./validationDetailPopup";

describe("ui/validationDetailPopup", () => {
  it("exports showValidationDetail", () => {
    expect(typeof showValidationDetail).toBe("function");
  });
});
