import { describe, expect, it } from "vitest";
import { defaultLspSettings, mergeLspSettings, type LspServerStatus } from "./types";

const mockServer: LspServerStatus = {
  id: "typescript",
  language: "typescript",
  label: "TypeScript",
  status: "installed",
  installHint: "npm i -g typescript-language-server",
  settings: [
    { key: "timeout", label: "Timeout", kind: "number", default: 30, min: 1, max: 120 },
    { key: "enabled", label: "Enabled", kind: "boolean", default: true },
  ],
};

describe("lsp/types", () => {
  it("builds default settings from server defs", () => {
    const defaults = defaultLspSettings([mockServer]);
    expect(defaults.typescript?.timeout).toBe(30);
    expect(defaults.typescript?.enabled).toBe(true);
  });

  it("merges LSP settings over defaults", () => {
    const merged = mergeLspSettings([mockServer], { typescript: { timeout: 60 } });
    expect(merged.typescript?.timeout).toBe(60);
    expect(merged.typescript?.enabled).toBe(true);
  });
});
