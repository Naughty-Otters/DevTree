import { describe, expect, it } from "vitest";
import { isTrufflehogMissingMessage } from "./types";

describe("trufflehog/types", () => {
  it("detects missing install messages", () => {
    expect(
      isTrufflehogMissingMessage(
        "trufflehog is not installed. Install it from Settings → Rules → Secret Scan (TruffleHog).",
      ),
    ).toBe(true);
    expect(isTrufflehogMissingMessage("No secrets detected by TruffleHog")).toBe(
      false,
    );
    expect(
      isTrufflehogMissingMessage(
        "gitleaks is not installed. Install it from Settings.",
      ),
    ).toBe(false);
  });
});
