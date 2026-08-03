import { describe, expect, it } from "vitest";
import { isGitleaksMissingMessage } from "./types";

describe("gitleaks/types", () => {
  it("detects missing-install validation messages", () => {
    expect(
      isGitleaksMissingMessage(
        "gitleaks is not installed. Install it from Settings → Rules → Secret Scan (gitleaks).",
      ),
    ).toBe(true);
    expect(isGitleaksMissingMessage("No secrets detected by gitleaks")).toBe(false);
  });
});
