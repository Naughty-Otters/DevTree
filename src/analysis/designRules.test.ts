import { describe, expect, it } from "vitest";
import {
  checkDesignRules,
  suggestLayersFromPartition,
  designRulesValidationItem,
  matchesTarget,
  defaultDesignRules,
  newRuleId,
} from "./designRules";
import type { HierarchyIndex } from "./types";
import { HIERARCHY_VERSION } from "./types";

function emptyHierarchy(): HierarchyIndex {
  return {
    version: HIERARCHY_VERSION,
    files: [],
    packages: [],
    file_imports: {},
    package_edges: [],
    symbols: {},
    symbol_edges: [],
  };
}

describe("matchesTarget", () => {
  it("matches exact and prefix paths", () => {
    expect(matchesTarget("app", "app")).toBe(true);
    expect(matchesTarget("app", "app/ui")).toBe(true);
    expect(matchesTarget(".", "anything")).toBe(true);
  });

  it("rejects non-matching prefixes", () => {
    expect(matchesTarget("app", "apple")).toBe(false);
    expect(matchesTarget("app", "lib")).toBe(false);
  });
});

describe("defaultDesignRules / newRuleId", () => {
  it("defaults to empty rules", () => {
    expect(defaultDesignRules()).toEqual([]);
  });

  it("generates unique-ish ids", () => {
    const a = newRuleId();
    const b = newRuleId();
    expect(a).toMatch(/^rule_/);
    expect(a).not.toBe(b);
  });
});

describe("checkDesignRules — success", () => {
  it("allows downward layer dependencies", () => {
    const h = emptyHierarchy();
    h.packages = ["core", "ui"];
    h.package_edges = [{ source: "ui", target: "core", kind: "import" }];
    const v = checkDesignRules(h, [
      { id: "L1", kind: "layers", layers: ["core", "ui"], enabled: true },
    ]);
    expect(v).toHaveLength(0);
  });

  it("allows same-layer dependencies", () => {
    const h = emptyHierarchy();
    h.packages = ["core", "ui", "util"];
    h.package_edges = [{ source: "ui", target: "util", kind: "import" }];
    // util not in layers → ignored; ui→core would be checked
    const v = checkDesignRules(h, [
      { id: "L1", kind: "layers", layers: ["core", "ui"], enabled: true },
    ]);
    expect(v).toHaveLength(0);
  });

  it("suggests layers from partition order", () => {
    const rule = suggestLayersFromPartition(["core", "api", "ui"]);
    expect(rule.kind).toBe("layers");
    expect(rule.enabled).toBe(true);
    if (rule.kind === "layers") {
      expect(rule.layers).toEqual(["core", "api", "ui"]);
    }
  });

  it("checks file_imports via owning package", () => {
    const h = emptyHierarchy();
    h.packages = ["core", "ui"];
    h.files = [
      { path: "ui/a.ts", label: "a.ts", loc: 1, package: "ui" },
      { path: "core/b.ts", label: "b.ts", loc: 1, package: "core" },
    ];
    h.file_imports = { "ui/a.ts": ["core/b.ts"] };
    const v = checkDesignRules(h, [
      { id: "L1", kind: "layers", layers: ["core", "ui"], enabled: true },
    ]);
    expect(v).toHaveLength(0);
  });
});

describe("checkDesignRules — failure / negative cases", () => {
  it("flags upward layer dependencies", () => {
    const h = emptyHierarchy();
    h.packages = ["core", "ui"];
    h.package_edges = [{ source: "core", target: "ui", kind: "import" }];
    const v = checkDesignRules(h, [
      { id: "L1", kind: "layers", layers: ["core", "ui"], enabled: true },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]!.ruleId).toBe("L1");
    expect(v[0]!.from).toBe("core");
    expect(v[0]!.to).toBe("ui");
    expect(v[0]!.message).toContain("Layer violation");
  });

  it("enforces forbid rules", () => {
    const h = emptyHierarchy();
    h.packages = ["app", "lib"];
    h.package_edges = [{ source: "app", target: "lib", kind: "import" }];
    const v = checkDesignRules(h, [
      { id: "F1", kind: "forbid", from: "app", to: "lib", enabled: true },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("Forbidden dependency");
  });

  it("enforces forbid with path prefix", () => {
    const h = emptyHierarchy();
    h.packages = ["app", "lib"];
    h.files = [
      { path: "app/x.ts", label: "x.ts", loc: 1, package: "app" },
      { path: "lib/y.ts", label: "y.ts", loc: 1, package: "lib" },
    ];
    h.file_imports = { "app/x.ts": ["lib/y.ts"] };
    const v = checkDesignRules(h, [
      { id: "F1", kind: "forbid", from: "app", to: "lib", enabled: true },
    ]);
    expect(v.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores disabled rules even when deps violate", () => {
    const h = emptyHierarchy();
    h.packages = ["core", "ui"];
    h.package_edges = [{ source: "core", target: "ui", kind: "import" }];
    const v = checkDesignRules(h, [
      { id: "L1", kind: "layers", layers: ["core", "ui"], enabled: false },
      { id: "F1", kind: "forbid", from: "core", to: "ui", enabled: false },
    ]);
    expect(v).toHaveLength(0);
  });

  it("skips layers rules with fewer than two layers", () => {
    const h = emptyHierarchy();
    h.packages = ["core", "ui"];
    h.package_edges = [{ source: "core", target: "ui", kind: "import" }];
    const v = checkDesignRules(h, [
      { id: "L1", kind: "layers", layers: ["core"], enabled: true },
      { id: "L2", kind: "layers", layers: [], enabled: true },
    ]);
    expect(v).toHaveLength(0);
  });

  it("returns no violations for empty rules", () => {
    const h = emptyHierarchy();
    h.packages = ["a", "b"];
    h.package_edges = [{ source: "a", target: "b", kind: "import" }];
    expect(checkDesignRules(h, [])).toEqual([]);
  });

  it("returns no violations for empty hierarchy", () => {
    expect(
      checkDesignRules(emptyHierarchy(), [
        { id: "L1", kind: "layers", layers: ["a", "b"], enabled: true },
      ]),
    ).toEqual([]);
  });

  it("collects multiple violations across rules", () => {
    const h = emptyHierarchy();
    h.packages = ["core", "ui", "app"];
    h.package_edges = [
      { source: "core", target: "ui", kind: "import" },
      { source: "app", target: "core", kind: "import" },
    ];
    const v = checkDesignRules(h, [
      { id: "L1", kind: "layers", layers: ["core", "ui", "app"], enabled: true },
      { id: "F1", kind: "forbid", from: "app", to: "core", enabled: true },
    ]);
    expect(v.length).toBeGreaterThanOrEqual(2);
  });
});

describe("designRulesValidationItem", () => {
  it("passes when no violations", () => {
    const item = designRulesValidationItem([]);
    expect(item.status).toBe("pass");
    expect(item.rule_id).toBe("architecture_conformance");
    expect(item.affected).toEqual([]);
  });

  it("warns for a few violations", () => {
    const item = designRulesValidationItem([
      { ruleId: "L1", from: "a", to: "b", message: "x" },
    ]);
    expect(item.status).toBe("warn");
    expect(item.affected).toEqual(["a → b"]);
  });

  it("fails when more than five violations", () => {
    const violations = Array.from({ length: 6 }, (_, i) => ({
      ruleId: "L1",
      from: `a${i}`,
      to: `b${i}`,
      message: "x",
    }));
    const item = designRulesValidationItem(violations);
    expect(item.status).toBe("fail");
    expect(item.affected.length).toBeLessThanOrEqual(40);
  });
});
