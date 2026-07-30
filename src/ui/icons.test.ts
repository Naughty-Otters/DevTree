import { describe, expect, it } from "vitest";
import { createChevron, createFileIcon } from "./icons";

describe("ui/icons", () => {
  it("creates lucide SVG icons", () => {
    expect(createChevron(true).tagName.toLowerCase()).toBe("svg");
    expect(createFileIcon("app.ts").tagName.toLowerCase()).toBe("svg");
  });
});
