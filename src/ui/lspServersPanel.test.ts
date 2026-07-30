import { describe, expect, it } from "vitest";
import { createLspServersPanel } from "./lspServersPanel";

describe("lspServersPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() => createLspServersPanel(container, { servers: [], installing: new Set(), onInstall: async () => {} })).not.toThrow();
    expect(container).toBeDefined();
  });
});
