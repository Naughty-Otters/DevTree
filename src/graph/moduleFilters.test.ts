import { describe, expect, it } from "vitest";
import {
  classifyModules,
  DEFAULT_MODULE_FILTERS,
  parseModuleFilters,
  visibleIdsForFilters,
  type ModuleFilterFlags,
} from "./moduleFilters";
import type { Graph } from "./types";

function graph(): Graph {
  return {
    nodes: [
      { id: "iso", label: "iso", path: "iso", loc: 1, kind: "file" },
      { id: "a", label: "a", path: "a", loc: 1, kind: "file" },
      { id: "b", label: "b", path: "b", loc: 1, kind: "file" },
      { id: "hub", label: "hub", path: "hub", loc: 1, kind: "file" },
      { id: "c", label: "c", path: "c", loc: 1, kind: "file" },
      { id: "d", label: "d", path: "d", loc: 1, kind: "file" },
    ],
    edges: [
      { source: "a", target: "b", kind: "import" }, // a out-only, b in-only
      { source: "hub", target: "c", kind: "import" },
      { source: "c", target: "hub", kind: "import" }, // hub+c cycle, both hubs
      { source: "d", target: "hub", kind: "import" }, // d out-only into hub
    ],
  };
}

describe("graph/moduleFilters", () => {
  it("classifies independent, one-way, hub, and circular roles", () => {
    const g = graph();
    const map = classifyModules(g.nodes, g.edges);
    expect(map.get("iso")?.role).toBe("independent");
    expect(map.get("a")?.role).toBe("withDependencies");
    expect(map.get("b")?.role).toBe("withDependencies");
    expect(map.get("d")?.role).toBe("withDependencies");
    expect(map.get("hub")?.role).toBe("hub");
    expect(map.get("c")?.role).toBe("hub");
    expect(map.get("hub")?.circular).toBe(true);
    expect(map.get("c")?.circular).toBe(true);
    expect(map.get("a")?.circular).toBe(false);
  });

  it("filters by enabled toggles", () => {
    const g = graph();
    const onlyIndependent: ModuleFilterFlags = {
      ...DEFAULT_MODULE_FILTERS,
      withDependencies: false,
      independent: true,
      circular: false,
      hub: false,
    };
    expect([...visibleIdsForFilters(g.nodes, g.edges, onlyIndependent)]).toEqual([
      "iso",
    ]);

    const onlyHub: ModuleFilterFlags = {
      withDependencies: false,
      independent: false,
      circular: false,
      hub: true,
    };
    expect([...visibleIdsForFilters(g.nodes, g.edges, onlyHub)].sort()).toEqual([
      "c",
      "hub",
    ]);

    const onlyCircular: ModuleFilterFlags = {
      withDependencies: false,
      independent: false,
      circular: true,
      hub: false,
    };
    expect([...visibleIdsForFilters(g.nodes, g.edges, onlyCircular)].sort()).toEqual([
      "c",
      "hub",
    ]);

    // With dependencies includes hubs (both directions), not only one-way links.
    const withDepsOnly: ModuleFilterFlags = {
      withDependencies: true,
      independent: false,
      circular: false,
      hub: false,
    };
    expect([...visibleIdsForFilters(g.nodes, g.edges, withDepsOnly)].sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "hub",
    ]);
  });

  it("parses persisted filters with defaults on", () => {
    expect(parseModuleFilters(undefined)).toEqual(DEFAULT_MODULE_FILTERS);
    expect(parseModuleFilters({ hub: false }).hub).toBe(false);
    expect(parseModuleFilters({ hub: false }).independent).toBe(true);
  });
});
