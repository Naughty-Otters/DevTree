import { describe, expect, it } from "vitest";
import { renderAiStreamPreview } from "./aiStreamPreview";

describe("ui/aiStreamPreview", () => {
  it("exports renderAiStreamPreview", () => {
    expect(typeof renderAiStreamPreview).toBe("function");
  });
});
