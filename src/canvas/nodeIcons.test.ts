import { describe, expect, it } from "vitest";
import { classifyNodeKind, nodeKindLabel } from "./nodeIcons";

describe("canvas/nodeIcons", () => {
  it("classifies and labels node kinds", () => {
    expect(classifyNodeKind("file")).toBe("file");
    expect(nodeKindLabel("class")).toBeTruthy();
  });
});
