import { describe, expect, it } from "vitest";
import { createLspServersPanel } from "./lspServersPanel";

describe("lspServersPanel", () => {
  it("creates or renders without throwing", () => {
    const container = document.createElement("div");
    expect(() =>
      createLspServersPanel(
        container,
        {
          servers: [],
          settings: {},
          expandedServerId: null,
          installingId: null,
          errors: {},
          loading: false,
        },
        {
          onRefresh: () => {},
          onInstall: async () => {},
          onSettingsChange: () => {},
        },
      ),
    ).not.toThrow();
    expect(container).toBeDefined();
  });
});
